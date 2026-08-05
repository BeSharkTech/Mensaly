# Exportação de alunos e ficha individual

## Objetivo

Permitir que o dono do local exporte a lista de alunos agrupada por plano e baixe a ficha completa de um aluno, sem criar novos endpoints nem aceitar organização pelo navegador.

## Lista de alunos

Na aba **Alunos**, o painel de exportação usa exatamente o plano selecionado na tela. O usuário escolhe PDF ou CSV compatível com Excel e decide se inclui as informações da cobrança mais relevante de cada aluno. A exportação contém apenas os alunos já presentes na visão filtrada e agrupa a saída pelo nome do plano.

O PDF usa a marca e as cores já carregadas para a organização. O CSV é deliberadamente simples, em UTF-8 e separado por ponto e vírgula, para abrir corretamente no Excel em português.

## Ficha individual

No perfil/modal de um aluno haverá **Baixar ficha PDF**. A ficha contém foto quando disponível, dados cadastrais do aluno, responsável, plano/matrícula, valor personalizado se houver, campos adicionais e, opcionalmente, a cobrança atual. Ela usa somente os dados já autorizados pela sessão e carregados pela página.

## Segurança e falhas

Não serão enviados dados a um serviço externo: a geração ocorre no navegador. Arquivos de imagem permanecem referenciados pelo armazenamento existente. Sem alunos no filtro, a exportação permanece indisponível e mostra uma mensagem clara. O CSV protege valores que poderiam ser interpretados como fórmula pelo Excel.

## Testes

Cobrir: agrupamento por plano, inclusão/remoção dos campos de cobrança, escaping seguro do CSV e geração dos dados da ficha. Validar typecheck, lint focal e build do frontend.
