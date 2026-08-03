# Gate — automação mensal de cobranças

## Escopo entregue

- Dia e horário de abertura, além do dia de vencimento, configuráveis no onboarding e na edição
  de planos.
- Snapshot da janela de abertura e do vencimento em matrículas novas e propagação transacional para
  matrículas ativas quando o calendário do plano muda.
- Geração automática da cobrança no dia e horário locais configurados, com recuperação
  após indisponibilidade e sem duplicação.
- Ajuste seguro para o último dia de meses curtos.
- Reutilização integral do checkout transparente já existente.
- Nenhum novo envio automático de WhatsApp ou e-mail nesta entrega.

## Evidências executadas

- Migrations `20260801120000_charge_open_day` e
  `20260801143000_charge_open_time` aplicadas no banco local existente e no
  banco isolado `mensaly_test`.
- Prisma Client regenerado após a migration.
- Typecheck de API, worker e web aprovado.
- Lint de API, worker e web aprovado.
- Suíte completa da API: 34 testes aprovados. A execução direcionada de
  API/DTO teve 15 aprovações, incluindo valor padrão, rejeição da janela
  inválida e propagação do plano para a matrícula.
- Testes de integração do worker: 19 aprovados, incluindo antes do horário,
  no horário local, recuperação posterior, repetição idempotente, mês curto,
  concorrência e cancelamento simultâneo de matrícula.
- Testes do front: 20 aprovados, incluindo contrato que impede persistir
  agendamento automático no fluxo manual da V1.
- Build de produção do monorepo: 9 tarefas aprovadas.

## Segurança e isolamento

- A empresa continua derivada exclusivamente da sessão autenticada nas rotas
  de plano e matrícula.
- A propagação usa simultaneamente `organizationId`, `planId` e status ativo;
  não alcança matrículas de outra empresa.
- O worker consulta uma empresa ativa por vez e usa trava transacional com a
  empresa e a competência na chave.
- O navegador não envia `organizationId` e não escolhe o valor da cobrança.
- As restrições do banco exigem dias entre 1 e 31 e abertura menor ou igual ao
  vencimento.
- Alterações no plano e cobranças geradas continuam registradas na auditoria
  existente.

## Falhas futuras e recuperação

- Worker parado no dia ou horário de abertura: o próximo tick cria a cobrança atrasada.
- Dois workers concorrentes: trava e chave única impedem duplicação.
- Reinício após persistir a cobrança: a reconciliação encontra a competência e
  não cria outra.
- Dia inexistente no mês: abertura e vencimento usam o último dia disponível.
- Calendário inválido: API e banco rejeitam `chargeOpenDay > dueDay`.
- Stripe indisponível na abertura: a cobrança interna permanece criada; o
  checkout continua sendo solicitado e tentado separadamente, sem apagar a
  cobrança.
- Alteração de plano depois da geração: somente matrículas ativas futuras são
  atualizadas; a cobrança existente preserva valor, competência e vencimento.

## Operação

O worker executa uma reconciliação ao iniciar e depois conforme
`SCHEDULER_INTERVAL_MS`. Para diagnosticar uma competência, consultar os logs
com correlation ID, o `AuditLog` com ação `charge.generated_by_scheduler` e a
cobrança identificada por empresa, matrícula e `referenceMonth`.

O reprocessamento seguro é reiniciar o worker ou aguardar o próximo tick. Não é
necessário apagar registros e não se deve remover a restrição única.
