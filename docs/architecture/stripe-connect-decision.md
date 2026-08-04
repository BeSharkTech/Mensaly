# Decisão — Stripe Connect para cobranças dos alunos

> Decisão substituída em 2026-08-04 pela integração Mercado Pago OAuth +
> Checkout Bricks para cobranças dos alunos. Mantida apenas como histórico.

## Estado

Aceita em 2026-08-01. Substitui a preferência inicial pelo Asaas para as
cobranças dos alunos.

## Contexto

Cada empresa do Mensaly deve ter seu próprio checkout, identidade financeira,
saldo e repasses. A plataforma não deve misturar recursos de empresas nem usar
um identificador de organização fornecido pelo navegador como autoridade.

## Decisão

- Uma conta Stripe Connect por organização Mensaly.
- Cobranças diretas na conta conectada.
- Uma cobrança Mensaly por aluno, matrícula e mês de referência.
- Checkout incorporado criado no backend para a cobrança persistida.
- Dados bancários, documentos e verificação de identidade são coletados pela
  Stripe no componente Connect incorporado à interface Mensaly, nunca
  processados ou armazenados no backend Mensaly.
- `stripeAccountId`, valor, moeda e cobrança são derivados no servidor.
- Pagamento só é confirmado por webhook assinado e idempotente.
- PIX gera uma nova cobrança por mês; não é tratado como débito recorrente.
- Taxa por transação do Mensaly começa em zero. A assinatura SaaS continua em
  domínio e webhook separados.

## Consequências

Objetos de cobrança direta existem na conta conectada e precisam ser consultados
com o contexto dessa conta. A integração deve processar eventos Connect, manter
conciliação local e tratar requisitos novos, restrições, desconexão, reembolso e
disputa sem apagar dados financeiros.
