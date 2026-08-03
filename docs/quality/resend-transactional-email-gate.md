# Gate — e-mail transacional com Resend

Data: 2026-07-31

## Evidências locais

- Jornada real no navegador concluída sem erros no console:
  cadastro, confirmação do e-mail, login, onboarding, criação do plano inicial
  e abertura do dashboard.
- A confirmação local usa um token de desenvolvimento apenas quando
  `NODE_ENV` não é `production` e `EMAIL_DELIVERY_MODE=local`.
- Em modo `resend`, uma inscrição real persistiu `EMAIL_VERIFICATION` como
  `PENDING` na tabela `transactional_email`; o token ficou somente no payload
  AES-256-GCM, sem texto puro.
- As 20 migrations foram aplicadas em um banco PostgreSQL de teste limpo.
- API: 27 testes aprovados.
- Web: 9 testes aprovados, incluindo consumo único do token sob React
  `StrictMode`.
- Worker: 12 testes aprovados, incluindo envio idempotente, retry após HTTP
  503 e auditoria de rejeição permanente.
- Auth: 5 testes aprovados, incluindo adulteração de payload criptografado.
- Config: 12 testes aprovados, incluindo bloqueio de modo local em produção.
- Typecheck e lint aprovados em API, web, worker, auth e config.
- Build otimizado do monorepo aprovado.

## Segurança e falhas revisadas

- A organização continua derivada exclusivamente da sessão.
- Token de verificação é persistido como hash; o valor necessário ao envio
  fica criptografado na outbox.
- API e worker recusam produção sem Resend e sem chave de criptografia.
- Idempotência por mensagem, tentativas limitadas, backoff, timeout, estados
  explícitos e recuperação de lock após reinício estão implementados.
- Logs e auditoria não registram token, chave ou payload descriptografado.

## Gate externo pendente

O envio real pelo Resend não foi marcado como validado porque ainda não há
chave e domínio autenticado de staging. Antes de produção, executar o checklist
de `docs/operations/resend-transactional-email.md` e comprovar recebimento dos
três fluxos: confirmação, recuperação de senha e boas-vindas.
