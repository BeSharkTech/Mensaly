# Docker

O ambiente local usa Docker Compose para executar:

- PostgreSQL 17 como banco de dados principal;
- Redis 7.2 como infraestrutura para as futuras filas BullMQ.

## Requisitos

- Docker Desktop com o mecanismo Docker em execução;
- Docker Compose v2.

## Configurar as variáveis

No PowerShell:

```powershell
Copy-Item .env.example .env
```

No macOS ou Linux:

```bash
cp .env.example .env
```

O arquivo `.env` é local e não deve ser versionado. Os valores presentes em
`.env.example` são destinados exclusivamente ao desenvolvimento local.

## Validar a configuração

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml config --quiet
```

Quando o comando termina sem saída e com código `0`, a configuração é válida.

## Iniciar PostgreSQL e Redis

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml up -d --wait
```

Consultar o estado:

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml ps
```

## Verificar os serviços

PostgreSQL:

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml exec postgres `
  pg_isready -U mensaly -d mensaly
```

Redis:

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml exec redis redis-cli ping
```

O Redis deve responder `PONG`.

## Consultar os logs

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml logs --tail=100
```

Para acompanhar novos logs:

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml logs --follow
```

## Parar os serviços

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml down
```

Esse comando preserva os volumes `postgres_data` e `redis_data`.

> **Atenção:** `docker compose down --volumes` remove permanentemente os dados
> locais do PostgreSQL e do Redis. Use essa opção somente quando quiser
> reinicializar todo o ambiente.

## Ambiente de teste isolado

O ambiente de teste usa outro projeto Docker Compose, outras portas e
armazenamento temporário. Ele não lê nem altera os dados do desenvolvimento.

Validar a configuração:

```powershell
pnpm env:test:validate
```

Iniciar PostgreSQL e Redis de teste:

```powershell
pnpm env:test:up
```

Consultar o estado:

```powershell
pnpm env:test:status
```

Os endereços padrão são:

- PostgreSQL: `localhost:55432`;
- Redis: `localhost:56379`.

Ao executar testes que precisam desses serviços, use `NODE_ENV=test` e forneça
os endereços de teste como `DATABASE_URL` e `REDIS_URL`. Por exemplo, no
PowerShell:

```powershell
$env:NODE_ENV = "test"
$env:DATABASE_URL = "postgresql://mensaly_test:mensaly_test_local@localhost:55432/mensaly_test?schema=public"
$env:REDIS_URL = "redis://localhost:56379"
pnpm test
```

Encerrar e descartar todos os dados do ambiente de teste:

```powershell
pnpm env:test:down
```

Esse comando atua somente no projeto Docker `mensaly-test`. Os dados são
intencionalmente efêmeros e não devem ser usados para desenvolvimento.
# Local complete application stack

To validate the complete runtime (database, Redis, migrations, API, worker and
web) without any external provider, use the local compose overlay:

```powershell
docker compose -f infra/docker/compose.yaml -f infra/docker/compose.local.app.yaml up -d --build
```

The web app is exposed at `http://localhost:5174` and the API at
`http://localhost:3001`. Files are deliberately stored in the `local_files`
Docker volume only in this local setup. Stop application services without
destroying local data with:

```powershell
docker compose -f infra/docker/compose.yaml -f infra/docker/compose.local.app.yaml stop api worker web
```

## Staging and production image

`compose.app.yaml` uses one immutable image for migrations, API, worker and web;
the `APP` environment value selects the runtime. CI publishes approved images
to GHCR as `sha-<commit>`. Validate the external secret file with
`pnpm production:check:staging` or `pnpm production:check:live`, then deploy with
`pull` followed by `up -d --no-build`. Production containers run as a non-root
user with all Linux capabilities dropped and `no-new-privileges` enabled.
