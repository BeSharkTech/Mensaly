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

## Infraestrutura local

O Docker Compose disponibiliza PostgreSQL 17 e Redis 7.2 para desenvolvimento
local.

### Início rápido

1. Copie `.env.example` para `.env`.
2. Inicie os serviços:

   ```powershell
   docker compose --env-file .env -f infra/docker/compose.yaml up -d --wait
   ```

3. Execute `pnpm install`.
4. Execute `pnpm dev`.

Consulte [infra/docker/README.md](infra/docker/README.md) para validação,
verificação dos serviços, logs e encerramento seguro.
