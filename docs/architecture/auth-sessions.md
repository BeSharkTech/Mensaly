# Login, logout e sessões

Este documento descreve o bloco MEN-BE-006. Ele adiciona acesso por senha e
sessões, mas não substitui a futura verificação de e-mail nem cria empresas.

## Rotas

| Método e rota | Resultado |
| --- | --- |
| `POST /api/v1/auth/login` | Confere e-mail e senha e cria uma sessão. |
| `GET /api/v1/auth/session` | Confirma a conta associada à sessão atual. |
| `POST /api/v1/auth/logout` | Cancela a sessão atual. |

O login só é permitido para conta ativa com e-mail verificado. Senhas erradas
ou e-mail inexistente retornam a mesma resposta, para não revelar se uma conta
existe.

## Proteções

- o token da sessão é aleatório, fica somente em cookie `HttpOnly` e nunca é
  salvo no banco de forma utilizável;
- o banco guarda apenas o resumo SHA-256 do token; o cookie usa `SameSite=Lax`
  e exige `Secure` em produção;
- a sessão expira em sete dias por padrão, configurável por
  `AUTH_SESSION_TTL_HOURS` (máximo de 30 dias);
- logout revoga a sessão imediatamente;
- cinco tentativas de login inválidas para o mesmo e-mail em 15 minutos
  bloqueiam novas tentativas temporariamente;
- login, falhas, bloqueio temporário e logout são guardados no histórico com
  horário, IP e identificação do navegador quando disponível.

## Próximo bloco

MEN-BE-007 adicionará a confirmação de e-mail e a recuperação de senha usando
um adaptador local de mensagens, sem depender de serviços externos.
