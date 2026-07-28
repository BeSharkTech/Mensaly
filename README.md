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

O `pnpm install` gera automaticamente o Prisma Client usado pelo pacote de
banco. Depois de alterar `packages/database/prisma/schema.prisma`, execute
`pnpm db:generate` para atualizar o cliente durante o desenvolvimento.

Consulte [infra/docker/README.md](infra/docker/README.md) para validação,
verificação dos serviços, logs e encerramento seguro.

O arquivo `.env.example` da raiz é a referência oficial das variáveis de
ambiente. Nunca adicione senhas, tokens ou credenciais reais a esse arquivo.
Consulte [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md)
para conhecer as variáveis, os ambientes suportados e as regras de segurança.
