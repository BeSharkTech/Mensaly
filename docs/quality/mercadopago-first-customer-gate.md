# Gate do primeiro cliente — Mercado Pago

Data da validação local: 2026-08-04.

## Escopo aprovado localmente

- Checkout transparente personalizado com Pix e cartão de crédito.
- Pagamentos dos alunos pela API de Payments do Mercado Pago.
- Conta recebedora por empresa via OAuth; credenciais armazenadas criptografadas.
- Callback OAuth no domínio da aplicação e webhook no domínio da API.
- Webhook `payment` assinado, idempotente e seguro contra chegada antecipada.
- Stripe desativado e sem rotas publicadas para cobranças dos alunos.
- Imagem imutável, preflight de produção, HTTPS e deploy automatizado para VPS.
- Backup PostgreSQL externo com checksum, retenção e restauração em banco descartável.

## Evidências executadas

- `pnpm typecheck`, `pnpm lint` e `pnpm build` aprovados.
- 47/47 testes da API aprovados, incluindo OAuth, pagamento, webhook duplicado,
  timeout/retry e isolamento entre empresas.
- 25/25 testes do frontend e 20/20 testes de configuração aprovados.
- 27/27 testes de integração de PostgreSQL, BullMQ e worker aprovados.
- API e worker compilados iniciaram contra PostgreSQL/Redis e encerraram com segurança.
- 28 migrations aplicadas; segunda execução confirmou ausência de pendências.
- `pnpm audit --prod --audit-level high`: nenhuma vulnerabilidade conhecida.
- Todos os perfis Docker Compose, Caddy, Bash e ShellCheck aprovados.
- Ciclo real local de dump, upload S3 compatível, checksum, download, restauração,
  validação das tabelas centrais e remoção do banco descartável aprovado.
- Checkout de teste do Mercado Pago validado manualmente pela interface.

## Gate externo antes de cobrar o primeiro aluno

Estas provas dependem das credenciais reais e só podem ocorrer na infraestrutura
de produção:

1. Preencher os valores externos restantes em `/opt/mensaly/.env.production`.
2. Cadastrar no Mercado Pago exatamente o callback e o webhook descritos no runbook.
3. Autorizar uma conta real de escola pelo OAuth.
4. Fazer uma cobrança real de valor mínimo por Pix e outra por cartão.
5. Confirmar no banco e no painel que cada cobrança só ficou paga após o webhook.
6. Reenviar o mesmo webhook e provar que não houve pagamento duplicado.
7. Confirmar recebimento na conta Mercado Pago da escola e executar estorno controlado.
8. Verificar Sentry, saúde pública, backup automático e restauração pós-deploy.

O deploy deve ser interrompido se o preflight, a migration, a saúde, o backup ou a
restauração falharem. Uma resposta HTTP isolada não aprova produção.
