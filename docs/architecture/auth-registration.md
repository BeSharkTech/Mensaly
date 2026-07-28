# Cadastro por e-mail e senha

Este documento descreve o contrato entregue no bloco MEN-BE-005. Ele cobre
somente cadastro; login, sessão, verificação do e-mail e recuperação de senha
serão entregues nos próximos blocos da Fase 2.

## Endpoint

`POST /api/v1/auth/register`

Corpo da requisição:

```json
{
  "name": "Nome da pessoa",
  "email": "conta@empresa.com",
  "password": "uma-senha-com-no-minimo-12-caracteres"
}
```

O nome deve ter de 2 a 120 caracteres, o e-mail deve ser válido e a senha deve
ter de 12 a 128 caracteres. Campos não reconhecidos são recusados.

Em caso de sucesso, a API responde `201` com os dados públicos da conta. A
conta nasce como `COMPANY_ACCOUNT`, com status `PENDING_VERIFICATION` e e-mail
ainda não verificado. Este bloco não cria empresa nem sessão.

## Proteções

- e-mails são normalizados antes da gravação;
- o banco impede duplicidade, inclusive diferenças entre maiúsculas e
  minúsculas;
- a senha não é armazenada nem retornada em texto legível: é derivada com
  `scrypt`, sal aleatório e comparação em tempo constante;
- usuário, credencial e auditoria são criados juntos: se uma parte falhar,
  nenhuma conta parcial permanece no banco;
- uma tentativa de cadastro duplicado retorna `409` com o código estável
  `EMAIL_ALREADY_REGISTERED`;
- dados inválidos retornam `400` no envelope padrão da API.

## Próximo bloco

MEN-BE-006 acrescentará login, logout, sessão, expiração, revogação, limite de
tentativas e histórico de acesso. A entrega de tokens de verificação por
adaptador local entra no MEN-BE-007, antes de qualquer integração com e-mail.
