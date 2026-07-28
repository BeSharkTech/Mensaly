# Contexto de autorização e isolamento entre empresas

## Fonte do contexto

O servidor lê o cookie `mensaly_session`, valida a sessão e cria o contexto
autenticado da requisição. Para uma `COMPANY_ACCOUNT`, a organização é buscada
no banco pelo usuário da sessão. O cliente nunca envia `organizationId` como
fonte de autorização.

Headers, parâmetros de URL e corpo com identificadores de empresa não alteram
esse contexto. Módulos futuros devem receber `organizationId` exclusivamente
do `CurrentAuth` estabelecido pelos guards.

## Guards reutilizáveis

| Guard | Regra |
| --- | --- |
| `SessionAuthGuard` | Exige sessão válida, ativa e com e-mail verificado. |
| `CompanyAccountGuard` | Exige `COMPANY_ACCOUNT`; se houver empresa, exige status `ACTIVE` e anexa seu ID ao contexto. |
| `PlatformAdminGuard` | Exige `PLATFORM_ADMIN` e não estabelece contexto de empresa. |

As rotas de empresa usam os dois primeiros guards. Rotas administrativas ficam
em `/api/v1/admin/*` e usam `SessionAuthGuard` com `PlatformAdminGuard`, sem
reaproveitar silenciosamente a rota ou o contexto do cliente.

## Comportamentos de segurança

- empresa inativa ou bloqueada recebe `ORGANIZATION_INACTIVE` e não acessa
  suas rotas operacionais;
- cliente sem empresa ainda pode criar sua primeira empresa, mas não consultar
  ou editar uma inexistente;
- conta administradora não usa as rotas de empresa;
- consultas futuras devem incluir `organizationId` já derivado da sessão na
  própria operação de banco.

## Evidência automatizada

Os testes HTTP criam duas contas e duas empresas. A conta A tenta enviar o ID
da empresa B por query e header, mas recebe somente os dados da empresa A. Os
testes também comprovam o bloqueio de empresa inativa e o fluxo administrativo
separado.
