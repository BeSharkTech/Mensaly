# Painel administrativo e Sentry

O painel `/admin` é exclusivo para usuários `PLATFORM_ADMIN`. Ele não aceita uma organização enviada pelo navegador e exibe somente dados agregados da plataforma.

## Sentry somente leitura

Crie uma integração interna no Sentry com acesso mínimo de leitura à organização e aos eventos. Configure apenas na API:

```dotenv
SENTRY_API_BASE_URL=https://sentry.io/api/0
SENTRY_API_TOKEN=token_somente_leitura
SENTRY_ORG_SLUG=organizacao
SENTRY_PROJECT_ID=identificador_numerico_do_projeto
```

O token nunca é enviado ao frontend nem registrado nos logs. As consultas usam timeout de 5 segundos e cache de 60 segundos. Se o Sentry estiver sem configuração ou indisponível, o restante do painel continua funcionando.

## Estimativa de custo por empresa

Os custos mostrados são estimativas operacionais, não uma reprodução de faturas dos provedores. Os valores são informados em centavos:

```dotenv
ADMIN_MONTHLY_FIXED_COST_CENTS=0
ADMIN_EMAIL_COST_PER_THOUSAND_CENTS=0
ADMIN_STORAGE_COST_PER_GB_CENTS=0
```

- O custo fixo mensal é dividido entre as empresas ativas.
- O custo de e-mail usa os e-mails transacionais do dono da empresa no mês atual.
- O custo de armazenamento usa os arquivos ativos da empresa.
- Taxas cobradas diretamente pela Stripe das contas conectadas não são custo da plataforma e não entram no cálculo.

Com todas as premissas em zero, a interface mostra `Configurar` em vez de apresentar custo zero como se fosse um dado real.

## Operação e falhas

- `not_configured`: faltam token ou slug da organização no Sentry.
- `unavailable`: timeout, erro de autenticação, limite do provedor ou indisponibilidade temporária.
- `ready`: métricas e problemas não resolvidos foram consultados com sucesso.

Após alterar variáveis, recrie o contêiner da API. Revogue imediatamente o token se ele for exposto e gere outro com escopo mínimo.
