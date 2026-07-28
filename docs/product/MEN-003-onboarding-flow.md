# MEN-003 — Fluxo inicial de onboarding

## Objetivo

Definir o caminho inicial de uma pessoa proprietária desde a criação da conta até o primeiro acesso ao dashboard de sua empresa na Mensaly.

Este documento descreve a experiência esperada e os estados visíveis no front-end. Ele não define contratos de API, regras internas de autenticação ou modelagem do banco de dados.

## Resultado esperado

Ao concluir o onboarding, a pessoa deve:

- possuir uma conta com e-mail verificado;
- possuir uma empresa criada;
- estar vinculada à empresa como `OWNER`;
- ter essa empresa definida como organização ativa na sessão;
- chegar ao dashboard inicial com uma orientação clara sobre o próximo passo.

## Público principal

Pessoa proprietária de uma escola, academia, curso ou outra empresa que utilizará a Mensaly para administrar alunos e mensalidades.

## Fluxo principal

### 1. Criar conta

**Pergunta da pessoa:** “Como começo a usar a Mensaly?”

**Informações iniciais:**

- nome;
- e-mail;
- senha;
- confirmação de aceite dos termos aplicáveis.

**Ação principal:** `Criar conta`

**Saída esperada:** conta criada e instrução para verificar o e-mail.

### 2. Verificar e-mail

**Pergunta da pessoa:** “O que preciso fazer para continuar?”

A tela informa para qual endereço a verificação foi enviada e permite:

- abrir novamente o provedor de e-mail;
- reenviar a mensagem após o intervalo permitido;
- corrigir o endereço de e-mail;
- voltar para o login.

**Ação principal:** `Reenviar e-mail`, quando necessário.

**Saída esperada:** e-mail verificado e continuação segura do onboarding.

### 3. Entrar na conta

Caso a verificação não inicie automaticamente uma sessão, a pessoa deve entrar com e-mail e senha.

**Ação principal:** `Entrar`

**Saída esperada:** sessão autenticada sem organização ativa, direcionada à criação da empresa.

### 4. Criar empresa

**Pergunta da pessoa:** “Qual empresa vou administrar?”

**Informações mínimas propostas:**

- nome da empresa;
- tipo de cadastro: CNPJ ou CPF;
- número do documento;
- telefone.

Informações complementares, como endereço, logotipo e identidade visual, podem ser solicitadas posteriormente nas configurações para reduzir o esforço inicial.

**Ação principal:** `Criar empresa`

**Saída esperada:** empresa criada e pessoa vinculada como `OWNER`.

### 5. Ativar a empresa

Após a criação, a Mensaly deve definir a nova empresa como organização ativa na sessão.

O front-end não deve escolher ou enviar livremente um `organization_id` como fonte de autorização. A organização ativa e o acesso aos dados devem ser determinados pela sessão autenticada e validados pelo back-end.

**Saída esperada:** contexto da empresa ativo e navegação liberada para as áreas permitidas.

### 6. Acessar o dashboard

**Pergunta da pessoa:** “O que faço agora?”

Como a empresa ainda não possui dados, o dashboard deve apresentar um estado inicial, e não indicadores preenchidos artificialmente.

**Conteúdo prioritário:**

1. confirmação de que a empresa foi criada;
2. identificação da empresa ativa;
3. explicação breve do próximo passo;
4. ação principal para continuar a configuração.

**Ação principal proposta:** `Criar primeiro plano`

**Ações secundárias futuras:** configurar empresa, convidar equipe ou cadastrar aluno, conforme a ordem definitiva do produto e a disponibilidade dos módulos.

## Mapa de transições

| Origem | Ação ou condição | Destino |
| --- | --- | --- |
| Página inicial ou login | Selecionar “Criar conta” | Cadastro |
| Cadastro | Conta criada | Verificação de e-mail |
| Verificação de e-mail | E-mail confirmado | Login ou criação da empresa |
| Login | Sessão sem empresa | Criação da empresa |
| Login | Sessão com uma empresa | Dashboard |
| Login | Sessão com várias empresas | Seleção de empresa |
| Criação da empresa | Empresa criada | Ativação da empresa |
| Ativação da empresa | Organização ativa confirmada | Dashboard inicial |

## Destinos propostos

Os caminhos abaixo são nomes de produto para orientar a implementação futura. Devem ser confirmados antes da criação das rotas:

| Destino | Caminho proposto | Finalidade |
| --- | --- | --- |
| Login | `/login` | Entrar em uma conta existente |
| Cadastro | `/cadastro` | Criar uma conta |
| Verificação | `/verificar-email` | Orientar e confirmar a verificação |
| Empresa | `/onboarding/empresa` | Criar a primeira empresa |
| Seleção de empresa | `/selecionar-empresa` | Escolher uma organização já existente |
| Dashboard | `/dashboard` | Entrar no produto |

## Estados obrigatórios

### Carregamento

- bloquear apenas a ação que estiver sendo processada;
- preservar os dados já preenchidos;
- informar visualmente que a solicitação está em andamento;
- impedir envios duplicados.

### Validação

- apresentar cada erro próximo ao campo correspondente;
- manter o conteúdo válido já preenchido;
- levar o foco ao primeiro erro relevante após o envio;
- explicar como corrigir o problema em linguagem simples.

### Erro temporário

- informar que não foi possível concluir a ação;
- oferecer uma tentativa novamente;
- não afirmar que a conta ou empresa foi criada sem confirmação.

### E-mail já cadastrado

- orientar a pessoa a entrar na conta;
- oferecer acesso à recuperação de senha;
- não revelar informações adicionais sobre a conta.

### Sessão expirada

- direcionar para o login;
- explicar que é necessário entrar novamente;
- preservar o destino pretendido quando isso puder ser feito com segurança.

### Sucesso

- confirmar a conclusão da etapa;
- mostrar apenas uma ação principal de continuidade;
- evitar que um recarregamento repita a criação da conta ou da empresa.

### Dashboard vazio

- explicar por que ainda não existem indicadores;
- indicar o próximo passo;
- não apresentar zeros sem contexto ou dados fictícios.

## Retorno e recuperação

- a pessoa pode voltar do cadastro para o login;
- a pessoa pode corrigir o e-mail antes de concluir a verificação;
- o onboarding deve continuar da última etapa válida após novo login;
- uma pessoa que já possui empresa não deve ser obrigada a criar outra;
- acesso direto a uma etapa incompatível com o estado da conta deve levar ao próximo destino válido;
- nenhuma falha deve exigir o reinício desnecessário de todo o processo.

## Prioridade de conteúdo em telas pequenas

Em dispositivos móveis, devem permanecer imediatamente visíveis:

1. título da etapa;
2. orientação essencial;
3. campos necessários;
4. erro ou confirmação atual;
5. ação principal.

Textos de apoio extensos e ações secundárias podem aparecer depois do formulário, sem ocultar informações essenciais.

## Requisitos de acessibilidade para a implementação futura

- um título principal claro por tela;
- rótulos persistentes nos campos;
- ordem de foco coerente com a ordem visual;
- foco visível;
- erros associados aos respectivos campos;
- anúncio de erros gerais e confirmações importantes;
- operação completa por teclado;
- nenhuma informação transmitida somente por cor;
- foco direcionado de forma previsível após mudanças de etapa.

## Fora do escopo desta tarefa

- implementação das telas;
- design visual ou design tokens;
- contratos de API;
- configuração do Better Auth;
- schema do Prisma;
- regras de autorização;
- envio real de e-mails;
- criação do dashboard;
- fluxo de convite de membros;
- recuperação de senha;
- autenticação em dois fatores.

## Decisões pendentes

Antes da implementação, a equipe deve confirmar:

1. se a verificação de e-mail inicia automaticamente uma sessão;
2. quais dados da empresa são realmente obrigatórios no primeiro acesso;
3. se CNPJ ou CPF precisa ser validado ou apenas informado nesta etapa;
4. qual será o próximo passo principal do dashboard vazio;
5. como o onboarding funciona para uma pessoa que entrou por convite;
6. por quanto tempo um progresso incompleto de onboarding será preservado;
7. quais termos e políticas precisam de aceite no cadastro.

## Critérios de aceite do fluxo

- o caminho entre cadastro e dashboard está documentado;
- cada etapa possui objetivo, ação principal e saída esperada;
- os principais estados de carregamento, erro, validação e sucesso estão previstos;
- o fluxo contempla conta sem empresa, conta com uma empresa e conta com várias empresas;
- a organização ativa é tratada como contexto da sessão, e não como escolha livre do front-end;
- as decisões ainda não confirmadas estão registradas como pendências;
- nenhum comportamento de back-end não aprovado é apresentado como existente.

## Limite de validação

Este fluxo foi modelado a partir do planejamento oficial da Mensaly. Ainda não foi validado com usuários, protótipos, telas implementadas ou testes no navegador.
