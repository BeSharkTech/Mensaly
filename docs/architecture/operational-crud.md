# CRUD operacional

As rotas `/api/v1/plans`, `/students`, `/guardians` e `/enrollments` exigem sessão de `COMPANY_ACCOUNT` ativa. A empresa é sempre derivada da sessão.

- Planos usam valor inteiro em centavos, vencimento de 1 a 31 e status ativo/inativo.
- Alunos e responsáveis podem ser inativados, preservando histórico.
- Um responsável deve estar vinculado ao aluno antes da matrícula.
- Matrícula aceita somente aluno, responsável e plano ativos da mesma empresa; guarda nome e condições do plano no momento da criação.
- Um identificador de outra empresa não é encontrado, pois todas as consultas incluem `organizationId` da sessão.
- Listas de planos e alunos usam paginação; alunos aceitam busca e filtro de status.
