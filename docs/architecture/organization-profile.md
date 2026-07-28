# Organização e perfil único

## Objetivo

No MVP, cada conta do tipo `COMPANY_ACCOUNT` pode possuir exatamente uma
organização. Não há equipe, convite, seleção de empresa ou troca de contexto
neste estágio.

## Rotas

Todas as rotas exigem o cookie de sessão autenticada `mensaly_session`.

| Método | Rota | Finalidade |
| --- | --- | --- |
| `POST` | `/api/v1/organization` | Cria a única empresa da conta autenticada. |
| `GET` | `/api/v1/organization` | Consulta a própria empresa. |
| `PATCH` | `/api/v1/organization` | Atualiza dados permitidos da própria empresa. |

O identificador da organização nunca vem do corpo, query ou header. O servidor
encontra a organização pelo usuário da sessão.

## Dados e regras

- nome, CPF/CNPJ e telefone são obrigatórios na criação;
- CPF/CNPJ e telefone são normalizados antes de persistir;
- CPF/CNPJ é único para toda a plataforma;
- timezone deve ser um valor IANA válido, como `America/Sao_Paulo`;
- endereço e identidade visual são metadados JSON validados; não existe upload
  de arquivos nesta fase;
- `status` é somente leitura para a conta cliente. Ativar, inativar ou bloquear
  será responsabilidade de uma rota administrativa futura;
- criação e atualização geram registros de auditoria;
- uma trava transacional e a restrição única no banco impedem a criação de duas
  organizações pela mesma conta, mesmo sob requisições simultâneas.

## Erros relevantes

| Código | Significado |
| --- | --- |
| `SESSION_REQUIRED` / `SESSION_INVALID` | A sessão não existe, expirou ou foi revogada. |
| `ORGANIZATION_ALREADY_EXISTS` | A conta já possui sua organização. |
| `TAX_ID_ALREADY_REGISTERED` | CPF/CNPJ já pertence a outra organização. |
| `ORGANIZATION_NOT_FOUND` | A conta ainda não criou a empresa. |
| `VALIDATION_ERROR` | Campo ausente, inválido ou fora do contrato. |

As rotas e contratos também estão publicados no OpenAPI em `/api/docs-json`.
