# Aprovação de cadastro público

## Objetivo

Transformar o cadastro público de aluno em uma solicitação pendente. O local aprova para criar aluno, responsável, vínculo, matrícula e primeira cobrança; ao recusar e confirmar, a solicitação e todos os seus dados são excluídos definitivamente.

## Fluxo

1. O responsável envia o formulário público com dados, plano e foto.
2. A API valida o formulário, o plano, os campos e a idempotência, mas grava apenas uma `PublicEnrollmentSubmission` com estado `PENDING` e os dados necessários para a análise.
3. A nova rota autenticada `/permissoes-cadastro` lista solicitações pendentes e histórico de decisões da própria organização.
4. Ao aprovar, a API adquire locks por solicitação/documento/responsável e, em uma transação, verifica novamente plano, duplicidade e compatibilidade do responsável; então cria os registros operacionais e muda a solicitação para `APPROVED`.
5. Ao recusar, a interface exige confirmação destrutiva. A API remove definitivamente a foto, os dados pessoais e a solicitação. Não cria aluno, matrícula ou cobrança. Um evento de auditoria técnico sem dados pessoais registra apenas a ação, organização, momento e correlation ID.

## Dados

`PublicEnrollmentSubmission` deixa de apontar obrigatoriamente para aluno, responsável e matrícula. Passa a armazenar o snapshot pendente: dados do aluno, responsável, plano, valores de campos personalizados e referência à foto. O estado é `PENDING` ou `APPROVED`; a recusa não é persistida, pois a solicitação é apagada.

O mesmo `Idempotency-Key` retorna a solicitação existente enquanto estiver pendente e o resultado aprovado depois da decisão. Após a exclusão, a chave não pode recriar silenciosamente a mesma tentativa: um registro técnico de idempotência sem PII é preservado até a janela de rate limit expirar.

## Segurança e isolamento

- O token público só permite criar solicitação para o formulário que o assinou.
- Listar, aprovar e recusar derivam a organização da sessão autenticada.
- Documento, CPF do responsável, telefone e foto continuam validados antes de criar a solicitação.
- Aprovação repete todas as verificações mutáveis: plano ativo, documento duplicado, campos personalizados ainda válidos e compatibilidade de telefone do responsável já existente.
- Recusa apaga objeto no storage e banco na mesma operação lógica; se a remoção do storage falhar, a solicitação não é apagada e o local recebe erro recuperável.
- Logs não incluem CPF, RG, telefone, e-mail, token ou conteúdo preenchido.

## Interface

Adicionar “Permissões de cadastro” em Operações. A página terá contador de pendentes, lista mobile-first com foto, aluno, responsável, plano, data e ações de visualizar/aprovar/recusar. A visualização mostra todos os dados enviados. Ações possuem estado de carregamento, confirmação de recusa, foco acessível e alvos de toque de no mínimo 44 px.

O formulário público passa a confirmar “Solicitação enviada para análise” em vez de informar que o aluno foi cadastrado. Não exibe informações internas da análise.

## Testes

Cobrir criação pendente, idempotência, isolamento de organizações, aprovação completa, duplicidade detectada durante aprovação, plano desativado, concorrência, recusa com remoção de foto, rollback e respostas de interface para pendente/aprovada/erro.
