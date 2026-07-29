# Filas BullMQ

O MEN-BE-020 estabelece a infraestrutura de filas do Mensaly. O MEN-BE-021
conecta essa infraestrutura ao processamento funcional por meio de um adaptador
falso, ainda sem integrar provedores externos.

## Topologia

| Fila | Job | Finalidade |
| --- | --- | --- |
| `message-dispatch` | `dispatch-message` | Receber um agendamento persistido para processamento posterior. |
| `scheduled-tasks` | `scheduler-tick` | Reconciliar mensalidades, agendamentos e jobs atrasados. |
| `dead-letter` | `dead-letter` | Preservar falhas terminais para inspeção e recuperação manual. |

As chaves no Redis recebem o prefixo configurável `mensaly` por padrão. O
prefixo pode separar ambientes, mas nunca substitui o isolamento de dados por
`organizationId`.

## Idempotência

Cada job de mensagem usa `message-{scheduleId}` como ID. O mesmo agendamento
não gera dois jobs enquanto o registro original estiver retido no BullMQ. O
banco PostgreSQL continua sendo a fonte de verdade. Antes de cada tentativa, o
worker revalida o agendamento e usa sua chave de deduplicação também como chave
idempotente do adaptador.

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

## Processamento funcional local

O worker usa travas transacionais por organização/data, cobrança e agendamento.
Enquanto mantém essas travas, confirma novamente:

- cobrança pendente e agendamento ainda não enviado;
- empresa, matrícula, aluno e responsável ativos;
- vínculo atual entre aluno e responsável;
- telefone válido e inalterado desde o agendamento;
- lembretes habilitados, janela de envio e limite diário;
- ausência de bloqueio ativo para o telefone.

Cada execução cria uma `MessageDeliveryAttempt` e registra as transições em
`MessageScheduleHistory`. Sucessos podem terminar em `SENT`, `DELIVERED` ou
`READ`; falhas ficam classificadas como recuperáveis ou permanentes. Confirmação
de pagamento transforma o agendamento pendente em `CANCELLED` sem chamar o
adaptador.

O resultado local do adaptador é configurado por
`FAKE_MESSAGE_ADAPTER_OUTCOME`. Os valores aceitos são `SENT`, `DELIVERED`,
`READ`, `TRANSIENT_FAILURE` e `PERMANENT_FAILURE`.

## Limite desta etapa

Não há token nem chamada à Meta. Scheduler recorrente, recuperação temporal e
execuções atrasadas estão documentados em
[`scheduled-tasks.md`](./scheduled-tasks.md). A troca do adaptador falso por um
provedor externo também exigirá retirar a chamada de rede de dentro da transação
e adotar lease/outbox, sem enfraquecer a idempotência já persistida.
