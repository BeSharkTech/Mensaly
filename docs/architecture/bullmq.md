# Filas BullMQ

O MEN-BE-020 estabelece a infraestrutura de filas do Mensaly sem integrar
provedores externos e sem antecipar o processamento funcional do MEN-BE-021.

## Topologia

| Fila | Job | Finalidade |
| --- | --- | --- |
| `message-dispatch` | `dispatch-message` | Receber um agendamento persistido para processamento posterior. |
| `dead-letter` | `dead-letter` | Preservar falhas terminais para inspeção e recuperação manual. |

As chaves no Redis recebem o prefixo configurável `mensaly` por padrão. O
prefixo pode separar ambientes, mas nunca substitui o isolamento de dados por
`organizationId`.

## Idempotência

Cada job de mensagem usa `message-{scheduleId}` como ID. O mesmo agendamento
não gera dois jobs enquanto o registro original estiver retido no BullMQ. O
banco PostgreSQL continua sendo a fonte de verdade; o worker funcional deverá
revalidar o estado do agendamento antes de qualquer envio.

Jobs concluídos ficam retidos por até sete dias e falhas por até trinta dias,
com limite de 10.000 registros em cada estado. Essa retenção mantém diagnóstico
local sem permitir crescimento ilimitado no Redis.

## Retry e classificação

- falhas transitórias usam retry exponencial;
- o padrão é quatro tentativas, iniciando com backoff de um segundo;
- `TransientJobError` representa uma falha recuperável;
- `PermanentJobError` é convertido em `UnrecoverableError` e não é repetido;
- erros desconhecidos são tratados como transitórios para evitar perda
  precipitada de trabalho.

Ao esgotar tentativas ou receber uma falha permanente, o job é copiado uma única
vez para `dead-letter`. O ID da entrada é um hash determinístico da fila e do
job original.

## Shutdown e observabilidade

No encerramento, o worker para de receber trabalho, aguarda jobs ativos, conclui
transferências para a dead-letter, fecha as conexões BullMQ e só então desconecta
o PostgreSQL. Chamadas repetidas de shutdown reutilizam a mesma promessa.

O runtime registra eventos estruturados de início, conclusão, falha, envio para
dead-letter e encerramento. Também publica periodicamente contagens locais de
estados das duas filas.

## Limite desta etapa

O handler de produção permanece bloqueado até MEN-BE-021. Não há adaptador
falso, chamada à Meta, scheduler recorrente ou regra funcional de envio nesta
entrega.
