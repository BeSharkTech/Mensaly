# Cadastro público de alunos

## Escopo

Cada organização possui no máximo um formulário público ativo. O link usa token assinado e não
expõe `organizationId`. Um envio válido cria uma solicitação pendente, com consentimento e
auditoria, sem criar aluno, responsável, vínculo, matrícula ou cobrança.

Na tela **Permissões de cadastro**, o local aprova uma solicitação para criar aluno, responsável,
vínculo, matrícula ativa, cobrança do ciclo atual e campos adicionais em uma única transação. Ao
recusar e confirmar, a solicitação e a foto são excluídas definitivamente; resta apenas auditoria
técnica sem dados pessoais.

Os endpoints antigos em `/api/v1/public/forms/:organizationId` respondem `410 Gone`.

## Configuração

Defina uma chave exclusiva, base64 de 32 bytes, em todos os processos da API:

```dotenv
PUBLIC_ENROLLMENT_LINK_SECRET=
```

Ela deve ser diferente de `EMAIL_ENCRYPTION_KEY`, `PAYMENT_PROVIDER_ENCRYPTION_KEY` e
`PAYMENT_LINK_SECRET`. Para gerar uma chave no PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Não troque essa variável durante uma implantação comum: a troca invalida todos os links. Para
invalidar apenas o link de uma organização, use **Regenerar** na tela **Formulário de cadastro**.

## Controles

- Leitura pública: 60 requisições por minuto por IP + formulário.
- Envio: 5 tentativas a cada 15 minutos por IP + formulário.
- `Idempotency-Key` é obrigatório e deve ser novo para cada aluno.
- CPF tem validação por dígitos; RG é normalizado e único dentro da organização.
- O responsável existente só é reutilizado na aprovação quando CPF e WhatsApp coincidem.
- Plano, preço, vencimento e organização são sempre obtidos no servidor.
- CPF, RG, telefone, e-mail, token e corpo são redigidos nos logs.

Sem Turnstile, ataques distribuídos continuam sendo um risco aceito nesta versão. O texto técnico
de privacidade precisa de revisão jurídica antes de produção.

## Implantação

1. Faça e verifique um backup do PostgreSQL.
2. Configure `PUBLIC_ENROLLMENT_LINK_SECRET` no ambiente.
3. Aplique as migrations antes de iniciar a nova API.
4. Confirme a saúde da API e do frontend.
5. Em homologação, gere um link, envie um cadastro e confirme que ele ficou pendente sem aluno ou
   cobrança. Aprove-o e confirme no banco: aluno, responsável, vínculo, matrícula, cobrança,
   `PublicEnrollmentSubmission` e `AuditLog`.
6. Envie outro pedido, recuse-o com a confirmação e confirme que a solicitação e a foto foram
   removidas do banco e do storage.
7. Teste link desativado, link regenerado, plano inativo e repetição do mesmo envio.
8. Monitore erros `PUBLIC_ENROLLMENT_*`, `STUDENT_ALREADY_REGISTERED`,
   `GUARDIAN_VERIFICATION_REQUIRED` e `IDEMPOTENCY_KEY_REUSED` nos primeiros envios.

## Recuperação

O envio pendente e a aprovação são atômicos: falhas não criam registros operacionais parciais. A
recusa não remove a solicitação se a exclusão da foto falhar; o local pode tentar novamente. Não
repita manualmente um envio incerto com uma nova chave; tente primeiro a mesma `Idempotency-Key`.
Em incidente de chave global, restaure a chave anterior ou regenere os links de cada organização e
distribua os novos endereços.
