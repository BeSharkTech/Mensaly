type UserFacingErrorInput = {
  status: number;
  code: string;
};

const messagesByCode: Record<string, string> = {
  VALIDATION_ERROR: "Confira os dados informados.",
  EMAIL_ALREADY_REGISTERED: "Este e-mail já tem uma conta. Faça login.",
  INVALID_CREDENTIALS: "E-mail ou senha inválidos.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail antes de entrar.",
  ACCOUNT_BLOCKED: "Esta conta está indisponível. Entre em contato com o suporte.",
  LOGIN_RATE_LIMITED: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
  VERIFICATION_TOKEN_INVALID: "Este link de confirmação é inválido ou expirou.",
  PASSWORD_RESET_TOKEN_INVALID: "Este link de redefinição é inválido ou expirou.",
  SESSION_REQUIRED: "Sua sessão expirou. Entre novamente.",
  SESSION_INVALID: "Sua sessão expirou. Entre novamente.",
  UNAUTHORIZED: "Sua sessão expirou. Entre novamente.",
  FORBIDDEN: "Você não tem permissão para fazer isso.",
  NOT_FOUND: "Não encontramos o que você procura.",
  RESOURCE_NOT_FOUND: "Não encontramos o que você procura.",
  ORGANIZATION_NOT_FOUND: "Não encontramos este local.",
  TAX_ID_INVALID: "Informe um CPF ou CNPJ válido.",
  CPF_INVALID: "Informe um CPF válido.",
  RG_INVALID: "Informe um RG válido.",
  PHONE_INVALID: "Informe um telefone válido.",
  TIMEZONE_INVALID: "Informe um fuso horário válido.",
  STUDENT_DOCUMENT_REQUIRED: "Informe o CPF ou RG do aluno.",
  STUDENT_ALREADY_REGISTERED: "Já existe um aluno cadastrado com este documento.",
  ACTIVE_ENROLLMENT_EXISTS: "Este aluno já possui uma matrícula ativa neste plano.",
  GUARDIAN_LINK_REQUIRED: "Informe os dados do responsável.",
  PLAN_NOT_AVAILABLE: "Este plano não está disponível para cadastro.",
  BILLING_SOURCE_NOT_FOUND: "Não encontramos a origem desta cobrança.",
  BILLING_TARGET_INVALID: "Selecione alunos ou um plano válido para esta cobrança.",
  IDEMPOTENCY_KEY_REUSED: "Esta solicitação já foi processada com dados diferentes.",
  CHARGE_STATE_CONFLICT: "Esta cobrança não pode ser alterada agora.",
  BILLING_RULE_NOT_FOUND: "Não encontramos esta cobrança configurada.",
  BILLING_RULE_PAYMENT_IN_PROGRESS: "Há um pagamento em processamento nesta cobrança. Aguarde alguns instantes e tente novamente.",
  CHARGE_HAS_ACTIVE_PAYMENT: "Esta cobrança já possui um pagamento em andamento.",
  PUBLIC_ENROLLMENT_LINK_INVALID: "Este link de cadastro não está disponível.",
  PUBLIC_ENROLLMENT_SUBMISSION_NOT_FOUND: "Não encontramos esta solicitação de cadastro.",
  PUBLIC_ENROLLMENT_SUBMISSION_INVALID: "Esta solicitação não pode mais ser processada.",
  PUBLIC_ENROLLMENT_APPROVALS_DISABLED: "A aprovação de cadastros está desativada para este local.",
  MERCADOPAGO_NOT_CONFIGURED: "O Mercado Pago ainda não foi configurado.",
  MERCADOPAGO_OAUTH_STATE_INVALID: "A autorização do Mercado Pago expirou. Tente conectar novamente.",
  MERCADOPAGO_CONNECTION_SAVE_FAILED: "Não foi possível salvar a conexão com o Mercado Pago. Tente novamente.",
  MERCADOPAGO_CONNECTION_NOT_FOUND: "Conecte uma conta do Mercado Pago para continuar.",
  MERCADOPAGO_CONNECTION_NOT_READY: "A conexão com o Mercado Pago ainda não está pronta.",
  MERCADOPAGO_ACCOUNT_NOT_CONNECTED: "Conecte sua conta do Mercado Pago antes de criar cobranças.",
  MERCADOPAGO_WEBHOOK_INVALID: "Não foi possível validar a atualização recebida do Mercado Pago.",
  RATE_LIMITED: "Muitas tentativas. Aguarde um momento e tente novamente.",
};

function messageByStatus(status: number): string {
  if (status === 400) return "Confira os dados informados.";
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status === 403) return "Você não tem permissão para fazer isso.";
  if (status === 404) return "Não encontramos o que você procura.";
  if (status === 409) return "Não foi possível concluir porque estes dados já existem ou foram alterados.";
  if (status === 410) return "Este link não está mais disponível.";
  if (status === 413) return "O arquivo ou envio é grande demais.";
  if (status === 429) return "Muitas tentativas. Aguarde um momento e tente novamente.";
  if (status >= 500) return "Ocorreu um problema temporário. Tente novamente em instantes.";
  return "Não foi possível concluir a operação.";
}

export function userFacingMessage(input: UserFacingErrorInput): string {
  const knownMessage = messagesByCode[input.code];
  if (knownMessage) return knownMessage;
  if (input.code.startsWith("MERCADOPAGO_")) {
    return "Não foi possível concluir a operação com o Mercado Pago. Tente novamente.";
  }
  if (input.code.startsWith("AUTH_")) return "Não foi possível confirmar seu acesso. Entre novamente.";
  if (input.code.startsWith("FILE_")) return "Não foi possível processar este arquivo. Confira o formato e tente novamente.";
  return messageByStatus(input.status);
}

function validationDetailMessage(rawMessage: unknown): string {
  const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";
  if (message.includes("unavailable")) return "Indisponível no momento.";
  if (message.includes("required") || message.includes("obrigat")) return "Este campo é obrigatório.";
  if (message.includes("email")) return "Informe um e-mail válido.";
  if (message.includes("date") || message.includes("data")) return "Informe uma data válida.";
  return "Confira este campo.";
}

export function userFacingDetails(details: unknown): unknown[] | undefined {
  if (!Array.isArray(details)) return undefined;
  return details.map((detail) => {
    const source = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
    return {
      ...(typeof source.field === "string" ? { field: source.field } : {}),
      message: validationDetailMessage(source.message),
    };
  });
}
