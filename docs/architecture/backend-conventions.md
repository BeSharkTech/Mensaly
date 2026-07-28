# Convenções oficiais do back-end Mensaly

**Código:** MEN-BE-001  
**Status:** obrigatório  
**Escopo:** `apps/api`, `apps/worker` e pacotes de back-end

Este documento define o padrão que todos os módulos do back-end devem seguir.
Exceções exigem uma decisão arquitetural versionada em `docs/decisions`.

## 1. Arquitetura e dependências

A Mensaly usa um monólito modular. Cada domínio pertence à API, mas preserva
limites claros para poder evoluir sem acoplamento acidental.

```text
controller -> service -> repository/Prisma
                    -> porta de serviço externo
worker     -> service -> repository/Prisma
```

Regras:

- controllers traduzem HTTP e não contêm regra de negócio;
- services concentram casos de uso e transações;
- acesso ao banco ocorre por serviços/repositórios do domínio;
- módulos não importam arquivos internos de outro domínio;
- integrações externas são acessadas por interfaces e adaptadores;
- o front-end nunca é fonte de regras de autorização ou finanças;
- o n8n não participa do núcleo operacional.

Estrutura padrão:

```text
modules/<dominio>/
  <dominio>.module.ts
  <dominio>.controller.ts
  <dominio>.service.ts
  <dominio>.repository.ts
  contracts/
  errors/
  tests/
```

## 2. Contratos e validação

Zod é a fonte de verdade dos contratos de entrada e saída. Schemas reutilizáveis
ficam em `packages/contracts`; schemas exclusivos de um domínio permanecem no
próprio módulo.

```ts
export const createExampleSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export type CreateExampleInput = z.infer<typeof createExampleSchema>;
```

Regras:

- objetos de entrada usam `.strict()` para rejeitar campos desconhecidos;
- normalização ocorre no limite da aplicação;
- IDs, e-mails, telefones, datas e dinheiro possuem schemas compartilhados;
- respostas públicas usam contratos explícitos, nunca objetos Prisma crus;
- mudanças incompatíveis exigem nova versão da API;
- tipos TypeScript isolados não substituem validação em runtime.

## 3. HTTP e versionamento

- prefixo oficial: `/api`;
- versão inicial: URI `/v1`;
- recursos usam substantivos no plural;
- ações excepcionais usam sub-recursos, por exemplo `POST /payments/:id/refund`;
- `GET` não altera estado;
- criação retorna `201`; remoção sem corpo retorna `204`;
- recurso de outra organização se comporta como `404`.

## 4. Formato único de erro

Toda falha HTTP retorna:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "A requisição contém dados inválidos.",
  "details": [],
  "correlationId": "0e845d10-476f-4e0d-8349-74f2fca7bf01",
  "timestamp": "2026-07-28T12:00:00.000Z",
  "path": "/api/v1/examples"
}
```

`code` é estável e próprio para automação. `message` é seguro para o usuário.
`details` é opcional e não contém stack, SQL, credenciais, tokens ou caminhos
internos. Erros inesperados retornam `INTERNAL_ERROR` e são registrados pelo
logger com o mesmo `correlationId`.

## 5. Paginação, filtros e ordenação

Listagens usam paginação por página enquanto o volume do MVP for moderado:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "pages": 0
  }
}
```

- `page`: inteiro a partir de 1;
- `limit`: padrão 20, máximo 100;
- `sort`: somente campos permitidos pelo endpoint;
- direção: `asc` ou `desc`;
- filtros desconhecidos são rejeitados;
- toda ordenação possui desempate estável por `id`;
- endpoints de grande volume podem adotar cursor em uma nova versão contratual.

## 6. IDs, datas e dinheiro

- IDs persistidos são UUIDs gerados no servidor/banco;
- IDs são opacos e nunca carregam regra de negócio;
- timestamps persistidos usam `timestamptz` e UTC;
- respostas usam ISO 8601;
- timezone da organização só é aplicado ao interpretar regras locais;
- dinheiro é inteiro em centavos (`Int`/`BIGINT` quando necessário);
- `float`, arredondamento implícito e datas sem timezone são proibidos;
- mês financeiro usa referência explícita, não texto livre.

## 7. Transações e idempotência

Uma transação contém todas as alterações que precisam ocorrer juntas. O
callback recebe `Prisma.TransactionClient`; nenhuma função abre transação
aninhada implicitamente.

- chamadas externas não acontecem dentro da transação;
- validação dependente do banco e escrita crítica ficam na mesma transação;
- mensalidades, pagamentos, jobs e webhooks possuem chave idempotente;
- unicidade e concorrência são reforçadas pelo PostgreSQL;
- conflitos esperados viram erros de domínio estáveis;
- migrations aplicadas nunca são reescritas.

## 8. Logging e correlation ID

O logger é estruturado em JSON. Cada requisição recebe um UUID em
`x-correlation-id`; um valor válido recebido pode ser preservado e sempre é
devolvido na resposta.

Campos mínimos:

- `level`, `time`, `service`, `environment`;
- `correlationId`;
- método, rota, status e duração para HTTP;
- organização e usuário quando autenticados;
- nome do job e tentativa para workers.

Senhas, tokens, cookies, authorization headers, payloads de webhook completos e
dados pessoais desnecessários nunca são registrados.

## 9. Multiempresa e autorização

`organizationId` vem exclusivamente da sessão autenticada. Controllers não
aceitam a organização do corpo, query ou header como fonte de autorização.

Toda operação de empresa inclui o escopo na própria consulta:

```ts
await prisma.student.findFirst({
  where: { id, organizationId: context.organizationId },
});
```

É proibido buscar apenas por `id` e conferir a organização depois. Escritas e
remoções seguem a mesma regra. `PLATFORM_ADMIN` usa rotas administrativas
explícitas. Testes obrigatórios comprovam que uma empresa não lê, altera ou
remove registros de outra.

## 10. Auditoria

Mudanças sensíveis registram ator, organização, ação, entidade, identificador,
estado anterior, estado posterior, correlation ID e timestamp. Senhas, tokens
e segredos são removidos antes da persistência.

Registros financeiros e de auditoria não são apagados por CRUD comum.

## 11. Estratégia de testes

- testes unitários: regras puras e services com dependências controladas;
- testes HTTP: aplicação Nest/Fastify real via `inject`;
- testes de integração: PostgreSQL real isolado e migrations completas;
- testes de worker: adaptadores falsos, relógio controlado e job idempotente;
- testes de contrato: schemas Zod e formato de resposta;
- testes multiempresa: leitura, escrita e remoção entre organizações;
- testes de concorrência: mensalidades, pagamentos e jobs críticos.

Um script não pode retornar sucesso sem executar testes. Testes de banco usam o
ambiente de `infra/docker/compose.test.yaml` e nunca um banco real de produção.

## 12. Definition of Done

Cada módulo exige:

1. contratos e erros documentados;
2. autorização e isolamento aplicáveis;
3. testes felizes, de erro e segurança;
4. migration e SQL revisados quando houver banco;
5. OpenAPI atualizado quando houver HTTP;
6. `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` aprovados;
7. `pnpm audit --audit-level high` sem vulnerabilidades conhecidas;
8. CI aprovado e branch removida após merge.

