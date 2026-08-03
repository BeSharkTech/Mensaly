# Mensaly — Plano obrigatório de evolução

Este documento define a ordem de execução do SaaS. Siga as fases na ordem abaixo. Não pule critérios de saída, não misture dados entre empresas e não implemente membros, equipes, convites, papéis internos ou troca de organização no MVP: cada empresa tem um único dono autenticado.

## Regras permanentes

- A organização é sempre derivada da sessão autenticada; nunca aceite `organizationId` do navegador como autoridade.
- Valores monetários são armazenados em centavos.
- Toda operação financeira, administrativa e de comunicação relevante precisa de auditoria.
- Alterações devem ser feitas em módulos pequenos, com branch, testes, revisão e PR próprios.
- Não considerar uma mensagem entregue apenas porque foi aceita ou marcada como enviada.
- Não fazer reenvio automático se a sessão do WhatsApp cair ou se o estado da entrega estiver incerto.

## Gate obrigatório para toda etapa

Nenhuma fase, módulo ou integração pode ser declarada concluída apenas porque o código compila ou uma rota responde `200`. Antes de encerrar cada etapa, executar e registrar:

1. **Teste funcional completo:** validar a jornada real pela interface e API, incluindo sucesso, falha esperada e persistência no banco.
2. **Testes automatizados:** adicionar ou atualizar testes unitários, de integração e de contrato proporcionais ao risco; executar typecheck, lint, build e suíte de testes aplicável.
3. **Segurança:** revisar autenticação, autorização por sessão, isolamento entre empresas, validação de entrada, rate limit, exposição de segredos, logs e auditoria.
4. **Falhas futuras:** listar cenários de queda, repetição, concorrência, timeout, indisponibilidade do provedor, webhook duplicado, dados inválidos e retomada após reinício; implementar idempotência, retries limitados, filas e estados explícitos quando aplicável.
5. **Dados e migrations:** validar migration em banco limpo e banco existente, rollback/recovery quando possível, índices necessários e integridade dos dados.
6. **Observabilidade:** garantir logs acionáveis, correlation ID, métricas/alertas necessários e mensagens de erro compreensíveis na interface.
7. **Documentação e operação:** atualizar contrato, variáveis de ambiente, runbook de operação e plano de recuperação.
8. **Revisão final:** verificar diff, arquivos gerados/segredos, dependências, performance básica e efeitos sobre fases anteriores.

**Critério de aprovação:** só avançar para a próxima etapa após evidência concreta de que o fluxo funciona ponta a ponta, está isolado por empresa e possui comportamento seguro em falhas. Se depender de um provedor externo, validar em sandbox/homologação antes de produção.

## Fase 0 — Estabilização do produto

1. Corrigir e testar cadastro, login, sessão, onboarding e dashboard.
2. Padronizar contratos e respostas da API.
3. Testar cadastro de aluno, responsável, plano, matrícula, cobrança, evento, estoque e mensagens.
4. Garantir que a interface trate erros sem quebrar.
5. Manter ambiente de homologação e dados de demonstração.
6. Versionar e aplicar migrations de banco.

**Critério de saída:** uma empresa cria conta, configura o negócio, cadastra alunos, gera cobranças e navega sem erro.

## Fase 1 — Fundação para escala

1. PostgreSQL gerenciado, backups automáticos e restauração testada.
2. Redis para cache, filas e locks distribuídos.
3. Worker separado da API para tarefas assíncronas.
4. Arquivos em S3/R2, nunca em disco local de produção.
5. Docker, ambientes development/staging/production, domínio, HTTPS e variáveis seguras.
6. CI/CD com typecheck, lint, testes, build, migrations e deploy controlado.
7. Observabilidade: Sentry, logs estruturados com correlation ID, métricas e alertas.
8. Painel interno de saúde da plataforma.

## Fase 2 — Financeiro e pagamentos

Manter separados dois domínios: cobranças dos alunos e assinatura SaaS do Mensaly.

### Cobranças dos alunos

1. Integrar Stripe Connect com cobranças diretas por conta conectada, Checkout incorporado, PIX, cartão e webhook. Cada empresa recebe em sua própria conta Stripe; a assinatura SaaS do Mensaly permanece separada.
2. Criar cliente financeiro por responsável e cobrança externa por mensalidade.
3. Persistir IDs externos, link, QR PIX, vencimento e status.
4. Receber webhooks assinados e processá-los de modo idempotente.
5. Atualizar cobrança somente após confirmação real do provedor.
6. Lembretes, baixa manual auditada e conciliação diária Mensaly × provedor.

### Assinatura SaaS do Mensaly

1. Planos, trial, upgrade, downgrade, cancelamento e faturas.
2. Checkout, histórico e recibos.
3. Bloqueio controlado por inadimplência sem apagar dados.
4. Webhooks totalmente separados dos pagamentos das escolas.

## Fase 3 — Comunicação

### Baileys — desenvolvimento e homologação

1. Sessão isolada por empresa, QR Code, reconexão e desligamento seguro.
2. Credenciais criptografadas e fora do Git.
3. Fila com limite de velocidade, idempotência, tentativa, erro e bloqueio de destinatário.
4. Status: `QUEUED`, `SENT`, `DELIVERED`, `READ` e `FAILED`.
5. Nenhum disparo automático antes de conexão por QR e teste controlado.

### Produção — WhatsApp Business Cloud API

1. Manter uma interface interna de provedor de mensagens.
2. Usar Baileys somente em desenvolvimento/homologação.
3. Usar Meta WhatsApp Cloud API em produção.
4. Migrar sem alterar regras de cobrança ou interface do usuário.

### E-mail — Resend

1. Verificação de e-mail, recuperação de senha e boas-vindas.
2. Avisos de cobrança/pagamento como fallback de WhatsApp.
3. Alertas de segurança.
4. Domínio autenticado com SPF, DKIM e DMARC; templates e fila de e-mails.

## Fase 4 — Automação e worker

1. BullMQ/Redis para geração de cobranças, lembretes, envios e conciliação.
2. Jobs idempotentes, tentativas limitadas e dead-letter queue.
3. Rotinas diárias para vencimentos, atrasos, pagamentos pendentes e falhas.
4. Operação segura para reprocessar jobs.

## Fase 5 — Administração da plataforma

1. Área exclusiva da plataforma, separada das empresas.
2. Listar empresas, donos, status, alunos, cobranças e plano SaaS.
3. Busca, bloqueio/desbloqueio auditado, histórico e suporte em modo seguro.
4. Saúde de pagamentos, WhatsApp, Resend, filas e webhooks.
5. Falhas e reprocessamento idempotente.
6. MRR, churn, trial, inadimplência, receita, faturas e relatórios exportáveis.

## Fase 6 — Segurança, LGPD e confiabilidade

1. Rate limit para login, cadastro, QR e envios.
2. Senhas seguras, tokens únicos de reset e revogação de sessões.
3. Criptografar credenciais de provedores e sessões WhatsApp.
4. Auditoria, retenção, exclusão e exportação de dados.
5. Consentimento e opt-out de comunicação.
6. Backup diário, restauração testada e plano de incidentes.
7. Testes de autorização para impedir acesso cruzado entre empresas.

## Fase 7 — Produto e retenção

1. Dashboard financeiro baseado em dados reais.
2. Relatórios de inadimplência, recebimento e alunos ativos.
3. Importação CSV, exportação CSV/PDF e formulário público.
4. Portal de pagamento para responsáveis.
5. Notificações no sistema, central de ajuda, onboarding guiado e feature flags.

## Ordem de execução

1. Fase 0.
2. Fase 1.
3. Resend transacional.
4. Pagamentos dos alunos e webhooks.
5. Baileys em homologação: QR e fila, sem disparo automático.
6. Aba de envio conectada à fila.
7. Meta WhatsApp Cloud API para produção.
8. Assinatura SaaS do Mensaly.
9. Painel administrativo completo.
10. Fechamento de LGPD, backups, suporte e métricas.
