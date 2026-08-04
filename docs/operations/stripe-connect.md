# Stripe Connect — onboarding e cobranças dos alunos

> Documento histórico e integração inativa na primeira entrega. As cobranças
> dos alunos usam Mercado Pago e `STRIPE_CONNECT_MODE=disabled`. Não configure
> estas chaves na VPS até a assinatura SaaS da própria Mensaly ser implementada
> como um domínio separado.

## Escopo

- Uma conta Stripe Express conectada por organização Mensaly em produção.
- No sandbox, a API usa uma conta Custom e o dono preenche os requisitos com dados de teste oficiais dentro do componente incorporado; a Mensaly não simula nem persiste KYC.
- Uma cobrança Mensaly gera um checkout independente para o aluno.
- A cobrança é criada diretamente na conta conectada; a Mensaly não recebe nem repassa o dinheiro.
- Checkout incorporado com Pix e cartão. Pix não é recorrente: cada competência gera uma nova cobrança.
- A assinatura SaaS da Mensaly é outro domínio e não usa estas tabelas ou webhooks.

## Variáveis

```dotenv
STRIPE_CONNECT_MODE=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYMENT_LINK_SECRET=<base64 de 32 bytes>
```

Para gerar `PAYMENT_LINK_SECRET` no PowerShell sem imprimir ou versionar outras credenciais:

```powershell
$mensalyBytes = New-Object byte[] 32
$mensalyRng = [Security.Cryptography.RandomNumberGenerator]::Create()
$mensalyRng.GetBytes($mensalyBytes)
[Convert]::ToBase64String($mensalyBytes)
$mensalyRng.Dispose()
```

Esse segredo deve permanecer estável. Trocá-lo invalida todos os links públicos ainda ativos.

## Configuração no Stripe em modo de teste

1. Ative o Connect na conta da plataforma e conclua os dados da própria plataforma.
2. Use as chaves de teste da plataforma nas variáveis acima.
3. Crie um webhook para **eventos de contas conectadas** apontando para:
   `https://mensaly.online/api/v1/webhooks/stripe`.
4. Inscreva os eventos:
   - `account.updated`
   - `account.application.deauthorized`
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
5. Copie o signing secret desse endpoint para `STRIPE_WEBHOOK_SECRET`.
6. Reinicie a API depois de alterar o `.env`.

Para testes locais sem endpoint público, o Stripe CLI pode encaminhar eventos Connect:

```powershell
stripe listen --forward-connect-to http://127.0.0.1:3002/api/v1/webhooks/stripe
```

Use o `whsec_...` exibido pelo CLI somente enquanto esse listener estiver ativo.

Com uma conta conectada de sandbox já existente, valide a criação real de uma
Account Session sem imprimir o segredo:

```powershell
pnpm --filter @mensaly/api stripe:onboarding:verify
```

O script se recusa a executar fora de `STRIPE_CONNECT_MODE=test`.

## Jornada operacional

1. No onboarding, a Mensaly salva negócio e planos como incompletos.
2. A API cria ou reutiliza uma conta conectada com chave de idempotência por organização.
3. A API cria uma Account Session curta e o Connect.js monta o onboarding dentro da etapa `Recebimentos` da Mensaly.
4. O dono informa CPF/CNPJ, banco e documentos no componente seguro da Stripe incorporado à Mensaly; esses campos não passam pela API Mensaly.
5. Ao sair do componente, a API consulta a conta no Stripe e só conclui o onboarding quando cobranças e repasses estão habilitados.
6. Para uma cobrança pendente, `POST /charges/:id/checkout-link` cria ou reutiliza um token opaco.
7. A página pública cria ou reutiliza uma Checkout Session incorporada na conta conectada.
8. O navegador nunca confirma pagamento. O webhook assinado é o caminho principal.
9. No retorno do Stripe, a API consulta a Checkout Session diretamente no provedor e reconcilia uma sessão `paid` como proteção contra webhook atrasado ou indisponível. Nenhum status enviado pelo navegador é aceito como prova.

## Pix

- A Mensaly solicita a capacidade `pix_payments` ao criar uma conta conectada e
  tenta solicitá-la novamente, de forma segura, antes da primeira Checkout
  Session de uma conta já existente.
- Quando a capacidade estiver ativa e a cobrança estiver entre R$ 0,50 e
  R$ 3.000,00, o checkout incorporado oferece cartão e Pix. Fora dessa faixa,
  ou enquanto a Stripe processa requisitos da capacidade, cartão permanece
  disponível sem impedir a cobrança.
- O QR Code e o código copia e cola são exibidos pelo checkout seguro da
  Stripe; esses dados não passam pela Mensaly.
- A confirmação continua dependendo de webhook assinado ou da reconciliação
  direta no retorno. O método efetivamente usado é salvo como `PIX` ou `CARD`.

## Segurança e isolamento

- A organização protegida sempre vem da sessão; não existe `organizationId` aceito do navegador.
- IDs de cliente, conta e checkout são sempre usados no contexto da conta conectada correspondente.
- O token público é autenticado por HMAC e apenas seu hash fica no banco.
- Payloads completos de KYC não são persistidos. O inbox guarda somente campos sanitizados necessários à operação.
- Valores permanecem em centavos e são copiados da cobrança persistida, nunca do corpo público.
- Conta, link, cliente, sessão e webhook possuem idempotência e auditoria.
- O `client_secret` da Account Session nunca é persistido nem incluído em auditoria ou logs; cada renovação cria uma sessão nova.

## Falhas e recuperação

- Criação concorrente de conta ou checkout é serializada com advisory lock e lease com expiração.
- Timeout do Stripe pode ser repetido com a mesma chave de idempotência.
- Webhook duplicado não cria pagamento duplicado.
- Retorno/reconciliação repetido também não cria pagamento ou auditoria de confirmação duplicados.
- Uma sessão concluída pode deixar de fornecer `client_secret`; a reconciliação usa apenas status e PaymentIntent retornados pela API do Stripe.
- Eventos antigos não sobrescrevem um estado financeiro mais novo.
- Sessão expirada ou falha pode ser recriada pelo mesmo link enquanto a cobrança estiver pendente.
- Conta com requisitos pendentes bloqueia novos links, sem apagar cobranças ou dados.
- Falha ou expiração da Account Session exibe uma tentativa segura; o Connect.js solicita um segredo novo sem reutilizar o anterior.
- Fechar o componente não libera o dashboard por presunção: a API recupera a conta e exige `chargesEnabled` e `payoutsEnabled`.
- Reembolso e disputa deixam estado explícito para conciliação; não são tratados como pagamento recebido.

## Gate antes de produção

- Validar uma conta conectada de teste até `ENABLED`.
- Pagar uma cobrança de teste por cartão e outra por Pix.
- Confirmar no banco que cada evento duplicado resulta em um único pagamento.
- Testar falha, expiração, reembolso e disputa.
- Confirmar que outra organização não consegue consultar nem criar checkout da primeira.
- Conferir o saldo na conta conectada e o status real no dashboard Stripe.
- Só então trocar todas as chaves para `live`, criar um webhook de produção separado e definir `STRIPE_CONNECT_MODE=live` em produção.
