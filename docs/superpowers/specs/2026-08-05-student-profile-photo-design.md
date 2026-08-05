# Foto de perfil do aluno

## Objetivo

Exibir a foto do aluno de forma consistente no painel, sem armazenar binários no PostgreSQL e sem duplicar arquivos entre o cadastro público e o cadastro manual.

## Modelo de dados e armazenamento

- `Student.photoFileId` continuará como a única referência da foto.
- O conteúdo permanece em `StoredFile` e no adaptador de armazenamento configurado: disco local no desenvolvimento e R2 em produção.
- O banco guarda somente metadados e a chave do arquivo; nunca base64 ou bytes da imagem.
- Uma foto pode estar associada a somente um aluno. Trocar foto remove a referência anterior e agenda a exclusão segura do arquivo antigo.

## Fluxos

### Cadastro público

- A foto do aluno permanece obrigatória.
- Ao aprovar a solicitação, o arquivo já enviado passa a ser vinculado ao aluno criado; não haverá cópia de arquivo.

### Cadastro e edição manual

- O formulário do painel permitirá enviar foto opcional ao criar ou editar um aluno.
- A edição permitirá trocar ou remover a foto.
- Arquivos inválidos, grandes demais ou que não sejam imagens serão recusados pela mesma validação já usada pelo serviço de arquivos.

## Interface

- A lista de alunos terá avatar circular de tamanho reduzido, carregado apenas quando visível. Sem foto, mostra as iniciais.
- A visualização do perfil/modal do aluno exibirá uma foto maior e os controles de trocar/remover para usuários autenticados da organização.
- A foto será solicitada pelo endpoint autenticado de conteúdo de arquivos, preservando isolamento entre organizações.

## Segurança e desempenho

- Verificar organização e status ativo do arquivo antes de servir ou vincular a foto.
- Limitar tipo e tamanho no upload; usar `object-fit: cover` no avatar para não distorcer imagens.
- A lista não buscará o arquivo inteiro no estado da aplicação: renderiza apenas a URL do conteúdo e usa carregamento nativo preguiçoso.
- A remoção elimina a referência e o objeto do armazenamento com auditoria; nenhuma imagem fica armazenada no PostgreSQL.

## Testes

- Criar aluno manualmente com foto e verificar vínculo e exibição.
- Trocar e remover foto, verificando exclusão segura do arquivo anterior.
- Confirmar foto no cadastro público aprovado.
- Confirmar isolamento: outra organização não acessa a imagem.
- Confirmar avatar de iniciais quando não houver foto e renderização da foto na lista e no perfil.
