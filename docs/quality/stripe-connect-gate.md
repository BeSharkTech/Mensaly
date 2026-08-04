# Gate — Stripe Connect para cobranças dos alunos

> Gate histórico, substituído por `docs/operations/mercadopago-student-payments.md`.
> Stripe permanece desativado na primeira entrega.

## Evidências locais

- Schema Prisma validado e cliente gerado.
- Migrations `20260801090000_stripe_connect_foundation` e `20260801091000_stripe_checkout_session_version` aplicadas em banco existente e novamente em banco `mensaly_test` limpo.
- Teste de integração cria organização, conta conectada, aluno, responsável, matrícula, cobrança, link, cliente e checkout.
- O mesmo teste repete a reconciliação direta no Stripe, entrega o webhook duas vezes e confirma uma única baixa/pagamento.
- Configuração rejeita chaves incompatíveis entre modos `test` e `live`.
- API e interface passaram em typecheck e lint; a interface passou em testes e build de produção.
- Account Session protegida por sessão e empresa, com segredo efêmero nunca auditado.
- Teste do componente incorporado cobre carregamento, renovação de sessão, saída, falha e tentativa segura.
- O onboarding incorporado coleta apenas requisitos atualmente devidos; requisitos futuros são omitidos.
- A descrição do produto é derivada do segmento persistido da empresa, o telefone comercial conhecido é normalizado, ambos são preenchidos pelo backend e a descrição é excluída do formulário visível da Stripe.

## Revisão de segurança

- Tenant derivado da sessão nas rotas protegidas.
- Valor da cobrança derivado do banco.
- Token público opaco, autenticado e armazenado apenas como hash.
- Webhook validado pelo SDK oficial com corpo bruto e signing secret.
- Eventos armazenados de forma sanitizada e idempotente.
- Nenhuma chave, client secret ou dado bancário foi versionado.
- O preenchimento automático usa a organização da sessão autenticada; o navegador não escolhe a empresa nem envia a descrição usada no Stripe.
- Falhas de criação de Account Session são persistidas sem segredo e geram auditoria acionável.

## Evidência de homologação externa em sandbox

- Conta conectada de teste habilitada para cobranças e repasses.
- Checkout incorporado pago por cartão no Stripe Sandbox.
- Checkout, cobrança e pagamento persistidos como `PAID`, `PAID` e `CONFIRMED`.
- Duas reconciliações consecutivas produziram exatamente um pagamento de 12.000 centavos com a mesma PaymentIntent.
- O retorno exibe a confirmação sem tentar criar uma nova Checkout Session.
- A API real da Stripe criou uma Account Session de onboarding com segredo presente, chave pública configurada e expiração futura; a verificação reportou apenas booleanos.
- O onboarding existente foi percorrido no navegador até `Conta pronta para receber`, sem erro de console.
- O layout foi validado em 375 × 812 e 812 × 375, claro/escuro, sem overflow horizontal após a correção do indicador de etapas.

## Pendente para fechar o gate externo

Ainda falta comprovar o recebimento do webhook Connect assinado pelo listener/endpoint configurado, além de Pix, expiração, reembolso e disputa. Pix depende de ativação na conta conectada. A reconciliação direta protege o retorno do pagamento, mas não substitui o webhook para eventos assíncronos posteriores.
