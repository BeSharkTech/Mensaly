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

## Qualidade

- `pnpm lint` executa ESLint real nos aplicativos e pacotes com código.
- `pnpm typecheck` verifica os tipos TypeScript separadamente.
- `pnpm test` executa os testes reais de fundação do monorepo.
- `pnpm build` valida as compilações de produção.

Os testes usam o runner nativo do Node com `tsx`. Cada pacote ou aplicativo
que possui código executável deve manter ao menos um teste de fundação; novas
regras de negócio devem acrescentar seus próprios testes unitários e de
integração.

## Segurança de dependências

O workspace força versões corrigidas de dependências transitivas de produção
(`sharp`, `postcss` e `find-my-way`) em `pnpm-workspace.yaml`. Isso protege as
aplicações enquanto as dependências diretas ainda não publicam seus próprios
patches compatíveis.

Execute `pnpm audit --audit-level high` antes de publicar alterações de
dependências. Uma atualização direta de Next.js ou NestJS/Fastify deve remover
essas substituições somente depois de passar pela mesma validação completa.

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
