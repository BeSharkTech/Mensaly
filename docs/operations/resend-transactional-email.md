# E-mail transacional com Resend

## Arquitetura

Em produção, a API não chama o Resend diretamente. Ela cria o token, persiste
somente seu hash em `verification`, criptografa o valor com AES-256-GCM e grava
uma entrada idempotente em `transactional_email`.

O worker, acionado pela rotina BullMQ, reivindica a outbox, descriptografa o
conteúdo somente em memória e envia ao Resend com `Idempotency-Key`. Estados,
tentativas, erros e o ID do provedor ficam persistidos e auditados.

## Variáveis

- `EMAIL_DELIVERY_MODE`: `local` ou `resend`.
- `EMAIL_ENCRYPTION_KEY`: chave de 32 bytes em base64, igual na API e worker.
- `RESEND_API_KEY`: chave restrita de envio.
- `RESEND_FROM_EMAIL`: remetente do domínio verificado.
- `RESEND_WEBHOOK_SECRET`: segredo `whsec_...` fornecido pelo endpoint do
  Resend. É obrigatório quando o envio real está ativo.
- `WEB_APP_URL`: URL pública usada nos links.

Gere a chave no PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Não troque a chave enquanto houver e-mails pendentes. Nunca registre tokens,
payload descriptografado ou chaves nos logs.

## Desenvolvimento local

`EMAIL_DELIVERY_MODE=local` não chama serviços externos. A API expõe o token de
confirmação na resposta do cadastro apenas fora de produção, permitindo testar
cadastro, confirmação e login em localhost. A configuração de produção rejeita
esse modo.

## Estados e recuperação

- `PENDING`: aguardando worker.
- `PROCESSING`: reivindicado pelo worker.
- `SENT`: aceito pelo Resend; ainda não prova entrega na caixa de entrada.
- `FAILED_RETRYABLE`: falha temporária com backoff exponencial.
- `FAILED_PERMANENT`: erro permanente ou quatro tentativas esgotadas.

Locks com mais de dez minutos são recuperados após reinício. HTTP 429, 409 e
5xx geram retry; 400, 401, 403, 404 e 422 são permanentes.

## Webhook de entrega

Configure no Resend o endpoint `POST https://api.mensaly.online/api/v1/webhooks/resend`
com o segredo acima. Ative ao menos `email.delivered`, `email.delivery_delayed`,
`email.bounced`, `email.complained`, `email.failed` e `email.suppressed`.

A rota usa o corpo bruto e a assinatura Svix; rejeita assinatura inválida e
eventos com mais de cinco minutos. O `svix-id` é salvo na inbox para que uma
tentativa repetida seja reconhecida sem atualizar a mensagem novamente. Os
eventos atualizam `deliveryStatus` para `DELIVERED`, `DELIVERY_DELAYED`,
`BOUNCED`, `COMPLAINED`, `FAILED` ou `SUPPRESSED`; eventos recebidos fora de
ordem não substituem um estado mais novo. Cada atualização gera auditoria.

No painel do Resend, use **Send test event** e confirme HTTP 200. Em caso de
falha 5xx, o Resend tentará novamente; investigue o `x-correlation-id`, a
inbox administrativa e a saúde de banco/Redis antes de reenviar manualmente.

## Produção

1. Verifique o domínio no Resend.
2. Publique SPF e DKIM.
3. Publique DMARC em modo de relatório e endureça após validar os relatórios.
4. Salve as chaves em um cofre, nunca no Git.
5. Valide cadastro, confirmação, boas-vindas e reset em staging.
6. Alerte para falhas permanentes, backlog e idade da mensagem mais antiga.
