# Foto de perfil do aluno Implementation Plan

**Goal:** Permitir foto manual e pública, exibida como avatar na lista e no perfil sem binários no banco.

**Architecture:** Reutilizar `Student.photoFileId` e `StoredFile`; a API expõe metadados de foto nos alunos e usa o serviço de arquivos para vincular, substituir ou remover. O frontend envia imagem opcional no formulário manual e renderiza o endpoint autenticado de conteúdo.

### Task 1: Vínculo e contrato da foto

- Testar criação, substituição e remoção com isolamento por organização.
- Estender DTO e serviço operacional para aceitar `photoFileId`, validar arquivo ativo da organização e limpar referência anterior.
- Incluir `photoFile` no retorno/listagem de alunos.

### Task 2: Avatar e edição manual

- Testar avatar com foto e fallback de iniciais.
- Adicionar seleção de imagem, upload pelo endpoint existente, troca e remoção no formulário de aluno.
- Exibir avatar na lista e imagem maior no diálogo de edição/perfil.

### Task 3: Validação

- Executar testes API e web relevantes, typecheck, lint e build.
- Validar manualmente criação pública aprovada e criação manual com foto.
