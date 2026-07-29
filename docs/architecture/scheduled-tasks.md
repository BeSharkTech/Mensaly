# Tarefas agendadas

O MEN-BE-022 fecha o ciclo local de mensalidades e lembretes sem conectar
provedores externos. O PostgreSQL permanece como fonte de verdade e o BullMQ
coordena recorrência, atraso e entrega aos workers.

## Ciclo de reconciliação

A fila `scheduled-tasks` mantém o Job Scheduler `mensaly-scheduler`. Cada tick
executa uma reconciliação global com trava transacional no PostgreSQL. Além da
recorrência, o worker executa a mesma reconciliação imediatamente ao iniciar.
Isso recupera mensalidades ou mensagens que ficaram persistidas sem job após
uma interrupção.

Em cada execução:

1. empresas ativas são avaliadas no próprio timezone;
2. mensalidades do mês corrente são criadas para matrículas ativas;
3. regras habilitadas geram agendamentos idempotentes para cobranças pendentes;
4. regras removidas, desativadas ou sem template ativo cancelam agendamentos
   automáticos ainda pendentes;
5. mensagens dentro do horizonte são adicionadas à fila `message-dispatch`;
6. horários futuros usam jobs atrasados e horários vencidos executam sem atraso.

As chaves únicas do PostgreSQL, os IDs determinísticos do BullMQ e as travas de
reconciliação e geração impedem duplicidade mesmo com dois processos
concorrentes.

## Regras e templates

Cada regra de lembrete habilitada exige um `templateId` ativo da própria
empresa. O agendamento guarda:

- `automationKey`, formada pelo tipo e deslocamento da regra;
- snapshots do template e do responsável;
- `queuedAt` e `enqueuedFor`, usados para diagnóstico e reagendamento;
- histórico `SCHEDULER_CREATED`, `SCHEDULER_ENQUEUED`,
  `SCHEDULER_RESCHEDULED` ou `REMINDER_RULE_DISABLED`.

Antes da entrega, o worker revalida novamente se a configuração, a regra e o
template continuam ativos. Assim, uma desativação ocorrida entre dois ticks não
permite um envio indevido.

## Relógio e limites

O início da janela permitida define o horário do lembrete no timezone da
empresa. O cálculo usa dias de calendário e converte o horário local para UTC,
inclusive em timezones com mudança de offset.

Somente cobranças com vencimento até 60 dias antes ou depois do dia local entram
na geração de lembretes. Esse limite acompanha o deslocamento máximo aceito
pelas regras e evita recuperar cobranças antigas indefinidamente.

As variáveis operacionais são:

- `SCHEDULER_INTERVAL_MS`: intervalo dos ticks, padrão de 60 segundos;
- `SCHEDULER_LOOKAHEAD_MS`: horizonte para criar jobs atrasados, padrão de 24
  horas.

## Limite desta etapa

Não há token ou chamada Meta. O adaptador continua falso. Monitoramento externo,
alertas e integração com o provedor real permanecem para as fases posteriores.
