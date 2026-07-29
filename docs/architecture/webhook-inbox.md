# Webhook inbox genérico

O MEN-BE-023 adiciona uma caixa de entrada neutra para eventos externos sem
conectar Stripe, Meta, Chatwoot, Resend ou qualquer outro provedor.

## Persistência

Cada evento registra provedor, identificador externo, tipo, payload JSON,
organização opcional, estado, contador de tentativas, último erro e timestamps.
A combinação `provider + externalEventId` é única. Repetir o mesmo conteúdo
retorna o evento existente; reutilizar a chave com outro conteúdo gera
`WEBHOOK_EVENT_CONFLICT`.

Cada processamento cria uma tentativa numerada com resultado persistido. Os
estados possíveis são:

- `PENDING`;
- `PROCESSING`;
- `PROCESSED`;
- `FAILED_RETRYABLE`;
- `FAILED_PERMANENT`.

## Concorrência e recuperação

Uma trava consultiva por evento serializa a tomada do trabalho. Um evento em
processamento possui lease de cinco minutos: chamadas concorrentes não executam
o handler novamente, mas um processo interrompido pode ser retomado depois do
vencimento do lease.

O número da tentativa funciona como fencing token. Se um handler antigo
terminar depois de uma retomada, ele não sobrescreve o resultado mais recente e
sua tentativa é encerrada com `PROCESSING_LEASE_LOST`.

Falhas temporárias usam backoff exponencial e no máximo cinco tentativas. Falhas
permanentes nunca são repetidas. O handler recebe
`provider:externalEventId` como chave de idempotência para proteger seus efeitos
de domínio.

## API interna

As rotas `/api/v1/admin/webhook-events` exigem `PLATFORM_ADMIN` e permitem
receber, listar, consultar e acionar o processamento genérico. Endpoints
públicos e validações de assinatura específicos serão adicionados somente com
cada integração externa.
