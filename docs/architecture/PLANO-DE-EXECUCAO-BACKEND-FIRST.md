# Mensaly — Plano oficial de execução backend-first

**Status:** oficial para a continuidade do desenvolvimento
**Data da auditoria:** 28 de julho de 2026
**Repositório:** `BeSharkTech/Mensaly`
**Ponto de partida auditado:** `main` em `67a93cc`
**Estado atual verificado:** Gate F6 concluído; back-end completo, API v1
congelada e MEN-BE-023 a MEN-BE-028 integrados na `main` pelos PRs `#52` a
`#56`
**Modelo de trabalho:** sequencial, em um único computador

## Atualização de execução — Fase 6

**Situação em 29 de julho de 2026:** Fases 0 a 6 estão integradas na `main`.
MEN-BE-023 a MEN-BE-028 passaram por revisão local, CI e teste integral em
ambiente isolado recriado do zero.

As entregas abaixo foram concluídas na ordem backend-first:

| Fase | Resultado prático |
| --- | --- |
| F0 | Fundação confiável, dependências auditadas, lint e testes reais. |
| F1 | Banco, Prisma, migrations, lifecycle e base HTTP segura. |
| F2 | Cadastro, sessões, verificação, recuperação, empresa única e autorização multiempresa. |
| F3 | CRUDs de planos, alunos, responsáveis, vínculos e matrículas concluídos na `main`. |
| F4 | Mensalidades idempotentes, pagamentos internos, transições, auditoria, concorrência e integridade multiempresa integrados na `main`. |
| F5.1 | Configuração de lembretes com regras, janela de envio, timezone da empresa, limite, ativação e validação de conflitos integrada na `main`. |
| F5.2 | Templates internos, agendamentos persistidos, histórico, idempotência e cancelamento após pagamento integrados na `main`. |
| F5.3 | BullMQ com filas nomeadas, jobs idempotentes, retry, DLQ, métricas e shutdown seguro integrado na `main`. |
| F5.4 | Worker com adaptador falso, revalidação antes do envio, tentativas persistidas e estados `SENT`, `DELIVERED` e `READ` integrado na `main`. |
| F5.5 | Scheduler recorrente de mensalidades e lembretes, jobs atrasados, recuperação após reinício, concorrência e relógio controlado integrados na `main`. |
| F6.1 | Inbox genérico de webhooks com idempotência, leasing, retry e fencing integrado pelo PR `#52`. |
| F6.2 | Arquivos locais por abstração, validação de conteúdo e isolamento por empresa integrados pelo PR `#53`. |
| F6.3 | Consultas de dashboard e administração da plataforma integradas pelo PR `#54`. |
| F6.4 | Auditoria, rate limit, redaction, limites e hardening multiempresa integrados pelo PR `#55`. |
| F6.5 | API v1 congelada, OpenAPI, contratos, documentação, cobertura e seed controlado integrados pelo PR `#56`. |

O Gate F4 foi integrado pelo PR `#41`. MEN-BE-018 foi integrado pelo PR `#42`
com migration aplicada do zero em PostgreSQL isolado, rotas autenticadas,
contrato OpenAPI, auditoria, integridade multiempresa e testes de conflitos e
isolamento.

MEN-BE-019 foi integrado pelo PR `#44`, com templates e agendamentos isolados
por empresa, snapshots imutáveis, histórico de estados, prevenção de
duplicidade e cancelamento transacional após pagamento.

MEN-BE-020 foi integrado pelo PR `#46`, com o pacote compartilhado de filas,
runtime BullMQ no worker, retry exponencial, falhas permanentes sem repetição,
dead-letter determinística, métricas locais e encerramento seguro.

MEN-BE-021 foi integrado pelo PR `#48`, com adaptador falso configurável,
revalidação transacional de todas as pré-condições, idempotência, tentativas e
histórico persistidos, limite diário concorrente e consulta de tentativas pela
API. O CI validou migration limpa, PostgreSQL, Redis, BullMQ, build, testes e
runtimes compilados, sem token ou chamada Meta.

MEN-BE-022 foi integrado pelo PR `#50`, com geração mensal idempotente,
scheduler recorrente, jobs atrasados, recuperação após reinício, proteção
contra concorrência e revalidação de pagamento e regras. O CI validou migration
limpa, PostgreSQL, Redis, BullMQ, build, testes com relógio controlado e
runtimes compilados, sem token ou chamada Meta. Com isso, o Gate F5 foi
concluído.

O próximo trabalho funcional é a Fase 7: front-end sobre a API v1 congelada.
Integrações externas continuam bloqueadas até o gate de conclusão do
front-end.

## 1. Objetivo deste documento

Este documento adapta o planejamento anterior à nova ordem obrigatória de
execução:

1. construir e validar todo o back-end;
2. construir o front-end sobre contratos estáveis do back-end;
3. conectar os serviços externos somente no final.

Ele também registra o estado real encontrado no GitHub e no checkout local,
explica o que já existe, o que está incompleto e qual é o passo a passo para
continuar.

Este documento substitui:

- a ordem de sprints paralelas do planejamento anterior;
- qualquer instrução para desenvolver front-end e back-end ao mesmo tempo;
- qualquer instrução para integrar Stripe, Meta, Chatwoot, Resend, R2, Sentry
  ou outro provedor antes da conclusão do back-end e do front-end;
- os trechos do fluxo `MEN-003` que preveem várias organizações, seleção de
  organização, convite de equipe ou papel `OWNER`.

As decisões de produto e arquitetura que não entram em conflito com a nova
ordem continuam válidas, especialmente:

- monorepo com pnpm Workspaces e Turborepo;
- monólito modular;
- NestJS sobre Fastify;
- Prisma e PostgreSQL;
- Redis, BullMQ e worker separado;
- isolamento multiempresa;
- uma única conta de acesso por empresa cliente;
- valores financeiros em centavos;
- idempotência para mensalidades, jobs, pagamentos e webhooks;
- n8n fora do núcleo operacional do produto.

## 2. Regra de execução a partir de agora

```text
FUNDAÇÃO CONFIÁVEL
        ↓
BANCO E PRISMA
        ↓
BACK-END COMPLETO
        ↓
CONTRATOS DA API CONGELADOS
        ↓
FRONT-END COMPLETO
        ↓
INTEGRAÇÕES EXTERNAS
        ↓
HARDENING E PILOTO
```

Não haverá desenvolvimento funcional do front-end durante a fase de back-end.
O `apps/web` poderá continuar compilando, mas receberá apenas correções
estritamente necessárias para manter o monorepo saudável.

Não haverá chamadas reais a provedores externos durante as fases de back-end e
front-end. O sistema deverá usar portas, adaptadores falsos e fixtures locais
para que regras de negócio sejam implementadas e testadas sem Stripe, Meta,
Chatwoot, Resend, R2 ou Sentry.

## 3. Resultado da varredura do GitHub

### 3.1 Estado da `main`

Antes da auditoria, o checkout local estava cinco commits atrás de
`origin/main`. Ele foi atualizado por fast-forward até `67a93cc`, sem conflito
e sem alteração de código local preexistente.

Commits mais recentes já presentes na `main`:

| Commit | Entrega |
| --- | --- |
| `f670f94` | Fundação do monorepo |
| `8fb8cc9` | Documento inicial de onboarding `MEN-003` |
| `0fa10bf` | PostgreSQL e Redis locais com Docker Compose |
| `2683add` | CI básico do monorepo |
| `26f8bcb` | Padronização e validação do ambiente |
| `67a93cc` | Ambiente local isolado para testes |

### 3.2 Pull requests encontrados

Não há pull request aberto.

Os seguintes pull requests foram mesclados:

| PR | Situação | Resultado |
| --- | --- | --- |
| `#2` | Mesclado | Fluxo inicial de onboarding |
| `#3` | Mesclado | Fundação do monorepo |
| `#8` | Mesclado | PostgreSQL e Redis locais |
| `#10` | Mesclado | CI básico |
| `#12` | Mesclado | Variáveis de ambiente |
| `#14` | Mesclado | Ambiente isolado de testes |

Os checks de CI consultados nos PRs `#10`, `#12` e `#14` foram concluídos com
sucesso.

### 3.3 Fundação concluída

As quatro issues de fundação foram concluídas e integradas:

| Issue | Entrega | PR integrado |
| --- | --- | --- |
| `#4` | Prisma Client é gerado automaticamente após a instalação | `#15` |
| `#5` | ESLint real e compartilhado no monorepo | `#17` |
| `#6` | Runner real e testes de fundação, sem sucesso fictício | `#19` |
| `#7` | `pnpm dev` sem a opção obsoleta do Turbo | `#20` |

Não há issue de fundação aberta. O Gate F0 foi aprovado antes da primeira
migration de domínio.

### 3.4 Branch remota antiga

Existe a branch remota:

```text
feat/MEN-003-onboarding-flow
```

Ela possui histórico divergente porque o PR `#2` foi incorporado à `main` por
squash. O conteúdo final de
`docs/product/MEN-003-onboarding-flow.md` é igual ao conteúdo existente na
`main`. Portanto, a branch não contém trabalho funcional exclusivo e pode ser
removida após a equipe confirmar que não há nenhuma referência externa que
dependa dela.

Ela não deve ser usada como base para novas tarefas.

## 4. Estado real da implementação

### 4.1 Concluído

- Fase 0: fundação do monorepo, ambientes Docker, CI, lint, testes e auditoria;
- Fase 1: schema base, migrations, seed administrativo, módulo de banco e API
  HTTP;
- Fase 2: cadastro, login, logout, sessões, verificação, recuperação, perfil
  único da empresa e autorização multiempresa;
- Fase 3: CRUDs operacionais de planos, alunos, responsáveis, vínculos e
  matrículas;
- Fase 4: mensalidades, pagamentos internos, transações, concorrência e
  integridade financeira, integrada pelo PR `#41`;
- MEN-BE-018: configuração de lembretes, integrada pelo PR `#42`, com:
  - uma configuração por empresa;
  - regras `BEFORE_DUE`, `ON_DUE` e `AFTER_DUE`;
  - janela de envio, limite diário e ativação ou desativação;
  - timezone derivado da empresa autenticada;
  - validação de conflitos, auditoria e integridade multiempresa;
  - migration do zero e testes reais de conflitos e isolamento aprovados;
- MEN-BE-019: templates e agendamentos, integrado pelo PR `#44`, com:
  - templates internos ativáveis e nomes únicos por empresa;
  - agendamentos persistidos com snapshots do conteúdo e do destinatário;
  - estados e histórico cronológico de transições;
  - deduplicação idempotente e integridade multiempresa no banco;
  - cancelamento manual e cancelamento automático após pagamento;
  - locks transacionais para a corrida entre agendamento e pagamento;
  - migration do zero e testes reais de concorrência e isolamento aprovados;
- MEN-BE-020: infraestrutura BullMQ, integrada pelo PR `#46`, com:
  - pacote compartilhado `@mensaly/queue`;
  - filas `message-dispatch` e `dead-letter`;
  - IDs determinísticos por agendamento e deduplicação concorrente;
  - retry exponencial e classificação de falha transitória ou permanente;
  - DLQ idempotente para falhas terminais;
  - métricas estruturadas, retenção limitada e shutdown seguro;
  - runtime compilado conectado a PostgreSQL e Redis aprovado;
- todos os dados operacionais são derivados da empresa da sessão autenticada;
- `PLATFORM_ADMIN` permanece separado das rotas de empresa.

### 4.2 Não iniciado

- worker funcional de mensagens com adaptador falso;
- dashboard e painel administrativo;
- frontend funcional;
- integrações externas.

## 5. Resultado das validações locais

Para a conclusão local da Fase 4, foram executados:

```powershell
pnpm env:test:up
pnpm db:migrate:deploy
pnpm test:integration
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:runtime
pnpm audit --audit-level high
```

Todos terminaram com código de saída `0`. As migrations foram aplicadas no banco
isolado, os testes financeiros usaram PostgreSQL real e o audit não encontrou
vulnerabilidades conhecidas.

O Gate F4 foi integrado na `main` pelo PR `#41`.

Para MEN-BE-018, as 10 migrations foram reaplicadas do zero no PostgreSQL
isolado. Os 7 testes de integração do banco e os 14 testes da API passaram,
incluindo conflitos de configuração, autenticação, auditoria e isolamento entre
empresas. O CI foi aprovado e a tarefa foi integrada na `main` pelo PR `#42`.

Para MEN-BE-019, as 11 migrations foram reaplicadas do zero no PostgreSQL
isolado. Os 7 testes de integração do banco e os 15 testes da API passaram,
incluindo idempotência concorrente, snapshots, histórico, isolamento entre
empresas e a corrida entre agendamento e confirmação de pagamento. O gate
completo (`typecheck`, `lint`, testes, build, runtime e auditoria) e o CI foram
aprovados; a tarefa foi integrada na `main` pelo PR `#44`.

Para MEN-BE-020, as 11 migrations foram novamente aplicadas do zero. Passaram
os 7 testes de integração do banco, 5 testes BullMQ reais no Redis, 3 testes do
lifecycle do worker, 8 testes de configuração e os 15 testes da API. Os
runtimes compilados da API e do worker conectaram aos serviços isolados e
encerraram corretamente. Instalação congelada, build, `typecheck`, lint, suíte
completa e auditoria também passaram; o CI aprovou e o PR `#46` foi integrado
na `main`.

## 6. Decisões definitivas de domínio

### 6.1 Conta e empresa

- cada empresa cliente terá exatamente uma conta `COMPANY_ACCOUNT`;
- cada conta `COMPANY_ACCOUNT` estará ligada a exatamente uma organização;
- não haverá equipe da empresa, convite, membership, troca de organização ou
  seletor de organização no MVP;
- `PLATFORM_ADMIN` será uma conta interna da BeShark e não pertencerá a uma
  organização cliente;
- a organização nunca será aceita do corpo da requisição como fonte de
  autorização;
- `organizationId` será obtido do contexto autenticado no servidor;
- o banco deverá reforçar o vínculo 1:1 com restrições únicas, não apenas com
  validação na aplicação.

### 6.2 Dados multiempresa

Toda entidade pertencente a uma empresa deverá possuir `organizationId`.

Consultas, atualizações e exclusões deverão incluir esse escopo. Buscar por
`id` e validar a organização depois não é o padrão desejado; o filtro de
organização deve fazer parte da própria operação de banco.

Testes obrigatórios:

- empresa A não lê dados da empresa B;
- empresa A não altera dados da empresa B;
- empresa A não exclui dados da empresa B;
- identificadores válidos de outra empresa se comportam como recurso não
  encontrado;
- `PLATFORM_ADMIN` usa endpoints administrativos explícitos, sem reutilizar
  silenciosamente o contexto de uma empresa.

### 6.3 Dinheiro e datas

- dinheiro será armazenado como inteiro em centavos;
- não será usado `float` para valores financeiros;
- mensalidade usará mês de referência explícito;
- datas persistidas serão normalizadas;
- vencimentos e horários de envio deverão considerar o fuso configurado da
  organização;
- alterações financeiras relevantes deverão gerar auditoria.

### 6.4 Exclusão e histórico

- registros financeiros não serão apagados fisicamente por CRUD comum;
- planos, alunos, responsáveis e matrículas terão estados de ativação ou
  encerramento apropriados;
- exclusão física será reservada a dados sem histórico relevante e a rotinas
  administrativas explicitamente autorizadas;
- toda mudança sensível deverá preservar quem, quando, antes e depois.

## 7. Modelo de trabalho em um único computador

Haverá somente uma tarefa principal em andamento.

Fluxo obrigatório:

1. sincronizar a `main`;
2. escolher a próxima tarefa desbloqueada;
3. criar uma branch a partir da `main`;
4. implementar apenas o escopo da tarefa;
5. executar todas as validações aplicáveis;
6. conferir o diff;
7. fazer commit;
8. enviar a branch;
9. abrir PR;
10. revisar o PR;
11. corrigir observações;
12. mesclar por squash;
13. apagar a branch;
14. sincronizar a `main`;
15. iniciar a tarefa seguinte.

Comandos-base:

```powershell
git switch main
git pull --ff-only origin main
git status --short --branch
git switch -c feat/MEN-BE-XXX-descricao-curta
```

Antes do commit:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
git status --short
git diff
```

Quando a tarefa mexer em banco:

```powershell
pnpm env:test:up
# aplicar migration no banco isolado
# executar testes de integração
pnpm env:test:down
```

Regras:

- uma tarefa por branch;
- um PR por tarefa;
- nenhuma branch nova nasce de outra branch de feature;
- nenhuma alteração direta na `main`;
- nenhuma tarefa seguinte começa antes do merge da anterior;
- migrations nunca são reescritas depois de compartilhadas;
- mudanças de schema exigem revisão explícita do SQL gerado;
- credenciais reais nunca entram no repositório.

## 8. Roadmap sequencial

## Fase 0 — Tornar a fundação confiável

Esta fase termina apenas quando o CI deixa de produzir sucesso falso.

### F0.1 — Resolver issue `#4`

Objetivo: gerar o Prisma Client automaticamente no fluxo correto.

Critérios:

- checkout limpo;
- `pnpm install --frozen-lockfile`;
- `pnpm typecheck`;
- `pnpm build`;
- nenhuma etapa manual oculta;
- comando de geração documentado;
- arquivos gerados não versionados sem necessidade.

### F0.2 — Resolver issue `#5`

Objetivo: configurar ESLint real e compartilhado.

Critérios:

- `packages/eslint-config` funcional;
- API, worker, pacotes e web analisados;
- `lint` separado de `typecheck`;
- regras compatíveis com NestJS, Node e Next.js;
- CI aprovado.

### F0.3 — Resolver issue `#6`

Objetivo: eliminar testes placeholder.

Critérios:

- runner real padronizado;
- tarefas sem teste não fingem validação;
- testes mínimos reais para API, database, auth, contracts e worker;
- outputs do Turbo coerentes;
- documentação dos comandos de teste.

### F0.4 — Resolver issue `#7`

Objetivo: remover `--parallel` obsoleto e validar `pnpm dev`.

Critérios:

- web, API e worker iniciam juntos;
- não existe aviso de depreciação correspondente;
- encerramento dos processos funciona corretamente.

### Gate F0

- install limpo aprovado;
- Prisma Client gerado;
- lint real aprovado;
- testes reais aprovados;
- typecheck e build aprovados;
- CI confiável.

## Fase 1 — Banco, Prisma e base da API

### MEN-BE-001 — Convenções do back-end

Definir e registrar:

- organização dos módulos NestJS;
- padrão de DTO/contratos Zod;
- formato único de erro;
- paginação, filtro e ordenação;
- IDs e timestamps;
- transações;
- logging e correlation ID;
- estratégia de testes unitários e de integração.

### MEN-BE-002 — Prisma base e migrations

Criar a base do domínio:

- enums centrais;
- modelos de autenticação exigidos pelo Better Auth;
- `Organization`;
- vínculo 1:1 entre conta e organização;
- `AuditLog`;
- índices, unicidades e relacionamentos;
- primeira migration revisável;
- seed mínimo apenas para `PLATFORM_ADMIN` de desenvolvimento.

O seed não deverá inventar empresas ou dados comerciais.

### MEN-BE-003 — Módulo de banco

Implementar:

- instância única do Prisma por processo;
- lifecycle de conexão e encerramento;
- injeção no NestJS;
- acesso do worker ao mesmo pacote;
- transação reutilizável;
- teste de conexão e teste de migration em banco isolado.

### MEN-BE-004 — Base HTTP

Implementar:

- prefixo e versionamento da API;
- healthcheck e readiness;
- tratamento global de erros;
- validação de entrada;
- logging estruturado;
- correlation ID;
- OpenAPI;
- política inicial de CORS configurável, sem liberar qualquer origem em
  produção.

### Gate F1

- banco de teste nasce vazio, recebe todas as migrations e passa nos testes;
- API conecta e encerra sem vazamento;
- OpenAPI é gerado;
- healthcheck diferencia processo vivo de dependências prontas;
- nenhuma regra de negócio depende do front-end.

## Fase 2 — Autenticação, cadastro e multiempresa

### MEN-BE-005 — Cadastro

Implementar cadastro por e-mail e senha, validação, hash seguro, prevenção de
duplicidade e estado de verificação.

Como Resend só será conectado no final, a entrega de e-mail deverá usar uma
interface local. Em desenvolvimento e teste, o token poderá ser capturado por
um adaptador falso ou outbox de teste.

### MEN-BE-006 — Login, logout e sessão

Implementar:

- login;
- logout;
- sessão segura;
- revogação;
- expiração;
- rotação quando aplicável;
- limite de tentativas;
- histórico de acesso.

### MEN-BE-007 — Verificação e recuperação

Implementar:

- token de verificação de e-mail;
- reenvio com cooldown;
- token expirado, inválido e já utilizado;
- solicitação de recuperação;
- redefinição de senha;
- invalidação de sessões após troca de senha.

Tudo será testado sem provedor externo.

### MEN-BE-008 — Organização e perfil único

Implementar criação e atualização da empresa:

- razão/nome;
- CPF ou CNPJ;
- telefone;
- endereço;
- timezone;
- status;
- dados de identidade visual como metadados, sem upload real;
- vínculo 1:1 com `COMPANY_ACCOUNT`.

Não criar endpoints de membros, convites ou seleção de organização.

### MEN-BE-009 — Autorização

Implementar:

- contexto autenticado;
- guard de `COMPANY_ACCOUNT`;
- guard de `PLATFORM_ADMIN`;
- extração de `organizationId` somente da sessão;
- bloqueio de empresa inativa;
- testes de isolamento multiempresa.

### Gate F2

- cadastro completo funciona por API;
- verificação funciona com adaptador local;
- login e logout funcionam;
- recuperação funciona;
- empresa e conta ficam ligadas 1:1;
- nenhuma conta cliente acessa outra empresa;
- `PLATFORM_ADMIN` tem fluxo separado;
- todos os fluxos estão documentados no OpenAPI.

## Fase 3 — CRUD operacional

Cada módulo deverá incluir schema, migration quando necessária, contratos,
service, controller, autorização, auditoria, testes unitários, testes de
integração e documentação OpenAPI.

### MEN-BE-010 — Empresa

- consultar o próprio perfil;
- editar dados permitidos;
- ativar/bloquear apenas por ação administrativa autorizada;
- registrar auditoria.

### MEN-BE-011 — Planos

- criar;
- listar com paginação;
- detalhar;
- editar;
- ativar e desativar;
- valor em centavos;
- vencimento padrão;
- frequência;
- contagem de matrículas ativas.

### MEN-BE-012 — Alunos

- criar;
- listar, buscar, filtrar e paginar;
- detalhar;
- editar;
- ativar e inativar;
- observações;
- histórico básico;
- impedir perda de histórico financeiro.

### MEN-BE-013 — Responsáveis financeiros

- CRUD controlado;
- CPF opcional;
- telefone normalizado;
- relação de um responsável com vários alunos;
- histórico de vínculos;
- isolamento por organização.

### MEN-BE-014 — Matrículas

- ligar aluno, responsável e plano;
- permitir valor e vencimento personalizados;
- data de início e término;
- desconto;
- status;
- preservar histórico quando o plano muda;
- impedir vínculos entre registros de organizações diferentes.

### Gate F3

- todos os CRUDs funcionam somente por API;
- paginação e erros são consistentes;
- isolamento multiempresa está coberto em todos os módulos;
- nenhuma tela foi necessária para provar os fluxos;
- OpenAPI representa os contratos reais.

## Fase 4 — Domínio financeiro sem Stripe

### MEN-BE-015 — Motor de mensalidades

Implementar:

- geração por matrícula;
- mês de referência;
- cálculo de vencimento;
- valor final;
- desconto;
- estados;
- cancelamento;
- isenção;
- reabertura;
- baixa manual;
- histórico.

Restrição única mínima:

```text
organizationId + enrollmentId + referenceMonth
```

Executar a geração uma ou várias vezes deverá produzir o mesmo resultado.

### MEN-BE-016 — Pagamentos internos

Criar o modelo interno de pagamento sem Stripe:

- pagamento manual;
- vínculo com mensalidade;
- valor;
- método;
- data;
- referência externa opcional;
- estorno ou cancelamento controlado;
- conciliação pendente;
- auditoria.

### MEN-BE-017 — Transações e concorrência

Testar:

- dois processos gerando a mesma mensalidade;
- duas baixas simultâneas;
- falha no meio de uma transação;
- repetição da mesma requisição idempotente;
- atualização de status incompatível.

### Gate F4

- motor idempotente;
- regras financeiras cobertas;
- nenhuma dependência do Stripe;
- auditoria financeira disponível;
- testes usam PostgreSQL real isolado.

## Fase 5 — Mensagens, filas e workers sem Meta

Filas e workers pertencem ao back-end. Portanto, serão construídos agora, mas
sem chamar provedores externos.

### MEN-BE-018 — Configuração de lembretes

- regras antes e depois do vencimento;
- horários permitidos;
- timezone;
- limites;
- ativação e desativação;
- validação de conflitos.

### MEN-BE-019 — Templates e agendamentos

**Estado:** integrado na `main` pelo PR `#44`.

- templates internos;
- agendamentos persistidos no PostgreSQL;
- status de mensagem;
- prevenção de duplicidade;
- cancelamento após pagamento;
- histórico.

### MEN-BE-020 — BullMQ

**Estado:** integrado na `main` pelo PR `#46`.

- conexão;
- nomes de filas;
- job IDs idempotentes;
- retry e backoff;
- classificação de falha temporária e permanente;
- dead-letter strategy;
- shutdown seguro;
- observabilidade local.

### MEN-BE-021 — Worker de mensagens com adaptador falso

Antes de cada envio, o worker deverá confirmar novamente:

- mensalidade pendente;
- empresa ativa;
- aluno ativo;
- responsável ainda vinculado;
- telefone válido;
- mensagem ainda não enviada;
- horário permitido;
- limite disponível;
- ausência de bloqueio.

O adaptador falso deverá simular `SENT`, `DELIVERED`, `READ` e falhas. A
integração Meta Cloud será adicionada somente na fase final.

### MEN-BE-022 — Geração e tarefas agendadas

**Estado:** integrado na `main` pelo PR `#50`.

- scheduler de mensalidades;
- jobs recorrentes;
- recuperação após reinício;
- concorrência;
- execução atrasada;
- testes com relógio controlado.

### Gate F5

**Estado:** concluído após a integração de MEN-BE-022 pelo PR `#50`.

- filas e workers funcionam localmente;
- jobs são idempotentes;
- pagamento impede nova cobrança;
- retries não repetem falhas permanentes;
- tentativas e estados ficam registrados;
- nenhum token ou chamada Meta existe.

## Fase 6 — Back-end restante

### MEN-BE-023 — Webhook inbox genérico

**Estado:** integrado na `main` pelo PR `#52`.

Criar a infraestrutura interna:

- `provider`;
- `externalEventId`;
- `eventType`;
- payload;
- status;
- tentativas;
- erro;
- timestamps;
- unicidade por provedor e evento;
- processamento idempotente.

Ainda não criar endpoints específicos de Stripe, Meta, Chatwoot ou Resend.

### MEN-BE-024 — Arquivos por abstração

**Estado:** integrado na `main` pelo PR `#53`.

Criar:

- metadados de arquivo;
- autorização;
- interface de storage;
- adaptador local para desenvolvimento e teste;
- validação de tipo e tamanho;
- limpeza controlada.

Não conectar Cloudflare R2 nesta fase.

### MEN-BE-025 — Consultas de dashboard

**Estado:** integrado na `main` pelo PR `#54`.

Criar endpoints agregados para:

- alunos ativos;
- valor previsto;
- recebido;
- pendente;
- pagas;
- vencidas;
- inadimplência;
- próximos vencimentos;
- últimos pagamentos;
- falhas de mensagens;
- evolução mensal.

### MEN-BE-026 — Painel administrativo

**Estado:** integrado na `main` pelo PR `#54`.

Criar endpoints exclusivos de `PLATFORM_ADMIN` para:

- empresas;
- status;
- consumo;
- totais;
- falhas;
- custos internos disponíveis;
- histórico administrativo.

### MEN-BE-027 — Auditoria e segurança

**Estado:** integrado na `main` pelo PR `#55`.

- trilha de auditoria;
- redaction de segredos e dados sensíveis em logs;
- rate limits locais;
- validação de payload;
- limites de paginação;
- proteção contra mass assignment;
- revisão de índices;
- revisão de consultas N+1;
- testes de autorização.

### MEN-BE-028 — Congelamento da API

**Estado:** integrado na `main` pelo PR `#56`.

Entregáveis:

- OpenAPI completo;
- coleção ou exemplos de chamadas;
- mapa de erros;
- contratos versionados;
- seed de demonstração controlado;
- guia para o front-end;
- relatório de cobertura;
- checklist de segurança;
- backup e restore local documentados.

### Gate de conclusão do back-end

**Estado:** concluído em 29 de julho de 2026. O gate integral recriou os
serviços isolados, aplicou 16 migrations do zero e aprovou build, testes de
integração, typecheck, lint, suíte funcional, runtimes compilados, cobertura,
OpenAPI sem divergência, seed idempotente com login real e restauração de
backup em banco descartável. Evidências: `docs/quality/f6-gate-report.md`.

O front-end só será liberado quando:

- todas as migrations aplicarem do zero;
- todos os módulos previstos estiverem acessíveis por API;
- autenticação e recuperação estiverem completas;
- isolamento multiempresa estiver coberto;
- CRUDs estiverem completos;
- motor financeiro estiver completo;
- filas e workers funcionarem com adaptadores falsos;
- dashboards e administração possuírem endpoints;
- OpenAPI estiver atualizado;
- lint, typecheck, testes e build forem reais e aprovados;
- CI estiver aprovado;
- nenhum serviço externo for necessário para executar a suíte.

## Fase 7 — Front-end

Somente depois do gate do back-end:

1. preparar design system;
2. cliente HTTP tipado a partir dos contratos;
3. cadastro e login;
4. verificação e recuperação;
5. onboarding da empresa;
6. perfil e configurações;
7. planos;
8. alunos;
9. responsáveis;
10. matrículas;
11. mensalidades;
12. baixa manual e pagamentos;
13. configuração e histórico de mensagens;
14. dashboard;
15. painel `PLATFORM_ADMIN`;
16. estados de loading, vazio, erro e sucesso;
17. acessibilidade e responsividade;
18. testes de componentes;
19. testes end-to-end no navegador.

O front-end consumirá a API; não duplicará regras financeiras, de autorização
ou de multiempresa.

### Gate de conclusão do front-end

- todos os fluxos usam a API real local;
- não há dados hardcoded para simular sucesso;
- erros do back-end são tratados;
- estados de carregamento e vazio existem;
- navegação por teclado e foco são verificados;
- fluxos críticos passam no Playwright;
- nenhuma integração externa é necessária.

## Fase 8 — Integrações externas

As integrações serão adicionadas uma por vez, atrás das interfaces já testadas.

Ordem:

1. Resend para e-mails transacionais;
2. Cloudflare R2 para arquivos;
3. Stripe Billing para a assinatura da Mensaly;
4. prova técnica de Mercado Pago OAuth + Checkout Bricks para pagamentos dos alunos;
5. Meta WhatsApp Cloud API;
6. Chatwoot para atendimento humano;
7. Sentry e observabilidade externa;
8. outras integrações aprovadas.

Cada integração deverá possuir:

- sandbox ou ambiente de teste;
- adaptador isolado;
- secrets fora do repositório;
- timeout;
- retry controlado;
- idempotência;
- tratamento de indisponibilidade;
- logs sem segredos;
- métricas;
- testes de contrato;
- procedimento de ativação e desativação;
- documentação operacional.

O n8n continuará fora do fluxo principal.

### Regras específicas

#### Stripe

- verificar assinatura de webhook;
- persistir o evento antes de processar;
- garantir unicidade;
- usar transação;
- testar duplicidade;
- cancelar mensagens futuras após pagamento;
- consultar novamente a mensalidade no worker.

#### Meta WhatsApp Cloud API

- registrar o ID do provedor;
- distinguir `SENT`, `DELIVERED` e `READ`;
- não considerar HTTP `200` como entrega;
- processar callbacks idempotentemente;
- controlar rate limit e custos.

#### Chatwoot

- usar apenas para atendimento humano;
- não permitir alteração financeira direta;
- relacionar conversa e contato sem tornar o Chatwoot fonte oficial.

## 9. Definition of Done por tarefa

Uma tarefa só está concluída quando:

- critérios de aceite cumpridos;
- escopo do diff conferido;
- typecheck aprovado;
- lint real aprovado;
- testes reais aprovados;
- build aprovado;
- migrations testadas, quando aplicável;
- isolamento multiempresa testado, quando aplicável;
- erros tratados;
- logs adequados;
- OpenAPI e documentação atualizados;
- nenhum segredo adicionado;
- PR revisado;
- CI aprovado;
- branch removida após o merge.

## 10. Formato obrigatório das próximas tarefas

```text
Código:
MEN-BE-XXX

Objetivo:
Uma entrega verificável.

Dependências:
Tarefas que precisam estar concluídas.

Escopo permitido:
Pastas e arquivos que podem mudar.

Fora do escopo:
Tudo que não deve ser antecipado.

Regras:
Invariantes de domínio e segurança.

Critérios de aceite:
Resultados observáveis.

Testes obrigatórios:
Casos felizes, erros, isolamento, concorrência e idempotência aplicáveis.

Comandos de validação:
Comandos exatos que devem passar.
```

## 11. Próximos passos imediatos

A continuidade correta é:

1. dividir a Fase 7 em módulos de front-end;
2. gerar o cliente HTTP a partir do contrato v1 congelado;
3. implementar, revisar e validar os fluxos sobre a API local real;
4. concluir acessibilidade, responsividade e testes no navegador;
5. aprovar o gate do front-end;
6. conectar as integrações externas na ordem definida.

A Fase 7 está desbloqueada após a conclusão do Gate F6. Nenhum provedor
externo deverá ser conectado antes do gate de conclusão do front-end.
