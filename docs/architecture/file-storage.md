# Arquivos por abstração

O MEN-BE-024 mantém metadados no PostgreSQL e bytes atrás da interface
`StorageAdapter`. Nesta fase, apenas o `LocalStorageAdapter` está habilitado.
Cloudflare R2 permanece fora do runtime.

## Segurança e isolamento

As rotas `/api/v1/files` derivam a empresa da sessão autenticada. IDs enviados
por outra empresa retornam `FILE_NOT_FOUND`, sem revelar a existência do
arquivo.

Uploads usam `multipart/form-data`, aceitam um único arquivo e possuem limite
configurável por `FILE_MAX_SIZE_BYTES` (5 MiB por padrão). Somente PDF, PNG e
JPEG são aceitos, com validação da assinatura binária além do MIME informado.
O nome original é reduzido ao nome-base e nunca participa do caminho físico.

O caminho local é composto apenas por UUIDs de empresa e arquivo. O adaptador
rejeita caminhos absolutos, travessia de diretórios e chaves fora desse
formato. A escrita usa arquivo temporário, permissão restrita e rename atômico.

## Integridade e ciclo de vida

Cada arquivo registra tamanho e SHA-256. O download recalcula ambos antes de
entregar os bytes; ausência ou adulteração gera `FILE_STORAGE_CORRUPT`.

Os estados são `UPLOADING`, `ACTIVE`, `DELETING`, `DELETED` e `FAILED`.
Uploads só ficam visíveis após o objeto e os metadados estarem confirmados.
Exclusões são idempotentes, usam trava por arquivo e deixam um estado
recuperável se o storage falhar.

`POST /api/v1/files/cleanup` executa limpeza controlada e limitada a 100 objetos
incompletos da própria empresa. Registros ainda dentro do lease de cinco
minutos não são tocados. Upload, exclusão e limpeza concluída geram auditoria.

## Configuração local

- `LOCAL_STORAGE_PATH`: raiz do adaptador local, padrão `.local-storage`;
- `FILE_MAX_SIZE_BYTES`: limite entre 1 KiB e 25 MiB.

O diretório padrão é ignorado pelo Git. Em testes, a raiz padrão é redirecionada
para o diretório temporário do sistema e removida ao final.
