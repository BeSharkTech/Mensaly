# Mercado Pago — cobranças dos alunos

Esta integração atende somente às mensalidades cobradas pelas escolas. Cada organização conecta a própria conta Mercado Pago por OAuth e recebe diretamente nela. A assinatura SaaS da Mensaly continua fora deste fluxo.

## Arquitetura

1. O dono autenticado inicia `POST /api/v1/payment-integrations/mercadopago/authorize`.
2. O Mercado Pago retorna ao callback configurado e a API troca o código OAuth por credenciais do vendedor.
3. Access Token e Refresh Token são criptografados no banco com `PAYMENT_PROVIDER_ENCRYPTION_KEY`. Eles nunca são devolvidos ao navegador ou registrados em logs.
4. A escola gera um link usando `POST /api/v1/charges/:id/mercadopago-checkout-link`.
5. O responsável abre `/pagar/:token`; o Payment Brick tokeniza os dados e a API cria uma Order com o valor obtido da cobrança no banco.
6. Apenas uma Order `processed` com `status_detail=accredited`, confirmada diretamente na API do Mercado Pago, baixa a cobrança.
7. O webhook assinado é deduplicado pela inbox genérica e consulta a Order antes de atualizar o financeiro.

## Variáveis da API

```dotenv
MERCADOPAGO_MODE=test
MERCADOPAGO_API_BASE_URL=https://api.mercadopago.com
MERCADOPAGO_AUTH_BASE_URL=https://auth.mercadopago.com.br
MERCADOPAGO_CLIENT_ID=
MERCADOPAGO_CLIENT_SECRET=
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_OAUTH_REDIRECT_URI=https://app.staging.mensaly.online/api/v1/payment-integrations/mercadopago/callback
MERCADOPAGO_WEBHOOK_SECRET=
PAYMENT_PROVIDER_ENCRYPTION_KEY=
PAYMENT_LINK_SECRET=
```

`PAYMENT_PROVIDER_ENCRYPTION_KEY` e `PAYMENT_LINK_SECRET` devem ser chaves base64 independentes de 32 bytes e diferentes de `EMAIL_ENCRYPTION_KEY`. Gere cada uma fora do repositório e mantenha os valores no gerenciador de segredos do ambiente.

O Access Token e a Public Key globais são aceitos para operação/testes administrativos, mas as cobranças das escolas usam as credenciais obtidas por OAuth e armazenadas por organização.

## Configuração no painel Mercado Pago

- Modelo da aplicação: Marketplace, Split 1:1.
- Redirect URI: deve ser exatamente igual a `MERCADOPAGO_OAUTH_REDIRECT_URI`.
- Webhook de teste e produção: usar URLs separadas.
- Evento obrigatório: `Order (Mercado Pago)` / tópico `orders`.
- Também habilitar vinculação de aplicações, reclamações e chargebacks antes da produção.
- Nunca enviar a chave secreta, Client Secret, Access Token ou tokens OAuth por chat ou commit.

Enquanto a topologia pública definitiva não estiver fechada, deixe a URI do webhook configurável. No perfil atual de VPS, a candidata é `https://app.mensaly.online/api/v1/webhooks/mercadopago`; valide uma resposta assinada real antes de ativar pagamentos.

## Gate de homologação

1. Aplicar a migration em banco limpo e em uma cópia do banco existente.
2. Conectar duas contas de teste e provar isolamento entre organizações.
3. Testar cartão aprovado, cartão recusado, Pix pendente, Pix confirmado e expiração.
4. Repetir submit e webhook para provar idempotência.
5. Simular timeout do provedor e confirmar que a mesma tentativa é reconciliada sem cobrança duplicada.
6. Verificar que a confirmação cancela lembretes pendentes e cria auditoria.
7. Testar token OAuth expirado e renovação por Refresh Token.
8. Confirmar que nenhum token aparece em resposta, log, Sentry ou Git.

Produção só pode ser habilitada após uma cobrança real controlada e confirmação do recebimento na conta da escola.
