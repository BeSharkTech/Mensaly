# Mensaly

Monorepo da plataforma Mensaly.

## Aplicações

- `apps/web`: aplicação web em Next.js.
- `apps/api`: API NestJS com Fastify.
- `apps/worker`: workers para tarefas assíncronas.

## Pacotes

- `packages/database`: schema, migrations e Prisma Client.
- `packages/contracts`: contratos e validações compartilhadas.
- `packages/auth`: limites para integração de autenticação.
- `packages/logger`: logger estruturado compartilhado.
- `packages/config`: leitura e validação de ambiente.

## Começar

1. Copie os arquivos `.env.example` necessários para `.env`.
2. Execute `pnpm install`.
3. Execute `pnpm dev`.

Os serviços de PostgreSQL e Redis serão adicionados pela tarefa de infraestrutura correspondente.
