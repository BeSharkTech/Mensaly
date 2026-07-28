# Variáveis de ambiente

O arquivo `.env.example` da raiz é a referência oficial para as variáveis de
ambiente da Mensaly. Os arquivos `.env` contêm valores locais ou secretos e
nunca devem ser versionados.

## Desenvolvimento local

Crie o arquivo local a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

No macOS ou Linux:

```bash
cp .env.example .env
```

O Docker Compose, a API, o Prisma e o worker usam os valores desse arquivo. A
aplicação web ainda não possui variáveis públicas próprias.

## Variáveis atuais

| Variável            | Consumidor           | Obrigatória           | Finalidade                                                                 |
| ------------------- | -------------------- | --------------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`          | API e worker         | Não                   | Seleciona `development`, `test` ou `production`; o padrão é `development`. |
| `API_PORT`          | API                  | Não                   | Porta HTTP da API; o padrão é `3001`.                                      |
| `POSTGRES_DB`       | Docker Compose       | Sim no ambiente local | Nome do banco PostgreSQL local.                                            |
| `POSTGRES_USER`     | Docker Compose       | Sim no ambiente local | Usuário do PostgreSQL local.                                               |
| `POSTGRES_PASSWORD` | Docker Compose       | Sim no ambiente local | Senha exclusiva do desenvolvimento local.                                  |
| `POSTGRES_PORT`     | Docker Compose       | Sim no ambiente local | Porta exposta pelo PostgreSQL local.                                       |
| `REDIS_PORT`        | Docker Compose       | Sim no ambiente local | Porta exposta pelo Redis local.                                            |
| `DATABASE_URL`      | API, Prisma e worker | Sim                   | Endereço PostgreSQL completo.                                              |
| `REDIS_URL`         | API e worker         | Sim                   | Endereço Redis completo.                                                   |

Ao iniciar, a API e o worker validam os valores que consomem. Uma variável
ausente, uma porta inválida ou um endereço com protocolo incorreto encerra o
processo com uma mensagem de configuração clara.

## Teste

Use `NODE_ENV=test` e serviços isolados dos dados de desenvolvimento. As URLs
de banco e Redis de teste devem ser fornecidas pelo processo que executa os
testes ou pelo CI. Não reutilize bancos que contenham dados reais.

## Produção

Use `NODE_ENV=production`. A plataforma de hospedagem deverá injetar
`DATABASE_URL`, `REDIS_URL` e os demais segredos diretamente no processo. Não
envie um arquivo `.env` de produção ao repositório ou à imagem Docker.

O ambiente de staging, o cofre de segredos e as credenciais das integrações
serão configurados em tarefas posteriores, conforme o roadmap.

## Segurança

- mantenha somente valores locais não sensíveis no `.env.example`;
- nunca registre valores de variáveis secretas em logs;
- use credenciais diferentes em desenvolvimento, teste, staging e produção;
- adicione novas variáveis ao schema de `packages/config` e a este documento;
- variáveis públicas do Next.js deverão usar o prefixo `NEXT_PUBLIC_` somente
  quando puderem ser expostas no navegador.
