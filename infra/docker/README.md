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
