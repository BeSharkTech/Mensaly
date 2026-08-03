import {
  decryptPayload,
  type EncryptedPayload,
} from "@mensaly/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AuditActorType,
  TransactionalEmailKind,
  TransactionalEmailStatus,
  type PrismaClient,
} from "@mensaly/database";
import type { WorkerEnvironment } from "@mensaly/config";

type ResendResponse = { id?: string; message?: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function template(
  kind: TransactionalEmailKind,
  payload: { token?: string; name?: string },
  webAppUrl: string,
): { subject: string; html: string; text: string } {
  if (kind === TransactionalEmailKind.WELCOME) {
    const name = payload.name ?? "cliente";
    return {
      subject: "Bem-vindo ao Mensaly",
      html: `<p>Olá, ${escapeHtml(name)}.</p><p>Sua conta Mensaly foi confirmada com sucesso.</p>`,
      text: `Olá, ${name}. Sua conta Mensaly foi confirmada com sucesso.`,
    };
  }
  if (!payload.token) throw new Error("Encrypted email token is missing");
  const path =
    kind === TransactionalEmailKind.PASSWORD_RESET
      ? "/redefinir-senha"
      : "/verificar-email";
  const url = new URL(path, webAppUrl);
  url.searchParams.set("token", payload.token);
  const label =
    kind === TransactionalEmailKind.PASSWORD_RESET
      ? "Redefinir senha"
      : "Confirmar e-mail";
  return {
    subject:
      kind === TransactionalEmailKind.PASSWORD_RESET
        ? "Redefina sua senha Mensaly"
        : "Confirme seu e-mail Mensaly",
    html: `<p>Olá,</p><p>Use o link abaixo para ${label.toLowerCase()}.</p><p><a href="${escapeHtml(url.toString())}">${label}</a></p><p>Se você não solicitou esta ação, ignore este e-mail.</p>`,
    text: `${label}: ${url.toString()}`,
  };
}

type EmailAttachment = {
  content: string;
  filename: string;
  content_id: string;
  content_type: string;
};

type EmailContent = {
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
};

// Retained temporarily for backwards-compatible source maps while all sends use
// renderTransactionalEmail below.
void template;

type EmailLayoutInput = {
  eyebrow: string;
  title: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
  footerNote: string;
};

function mensalyLogoAttachment(): EmailAttachment {
  const logoPath = resolve(
    __dirname,
    "../../web/src/assets/mensaly-logo.png",
  );
  return {
    content: readFileSync(logoPath).toString("base64"),
    filename: "mensaly-logo.png",
    content_id: "mensaly-logo",
    content_type: "image/png",
  };
}

function emailLayout(input: EmailLayoutInput): string {
  const action = input.actionLabel && input.actionUrl
    ? `<tr><td align="left" style="padding:0 32px 24px;"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background-color:#3B4DF6;border-radius:10px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;padding:14px 22px;text-align:center;text-decoration:none;">${escapeHtml(input.actionLabel)}</a></td></tr>
            <tr><td style="padding:0 32px 28px;"><p style="margin:0 0 8px;color:#64748B;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">Se o bot&atilde;o n&atilde;o funcionar, copie e cole este link no navegador:</p><p style="margin:0;overflow-wrap:anywhere;"><a href="${escapeHtml(input.actionUrl)}" style="color:#3B4DF6;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;text-decoration:underline;">${escapeHtml(input.actionUrl)}</a></p></td></tr>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><style>@media only screen and (max-width:640px){.mensaly-email-card{width:100% !important;border-radius:0 !important}.mensaly-email-gutter{padding-left:20px !important;padding-right:20px !important}}</style></head>
<body style="margin:0;padding:0;background-color:#F4F6FF;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6FF;"><tr><td align="center" style="padding:40px 16px;"><table role="presentation" class="mensaly-email-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FFFFFF;border:1px solid #E3E8F7;border-radius:16px;overflow:hidden;">
<tr><td class="mensaly-email-gutter" style="padding:26px 32px 22px;background-color:#FFFFFF;border-bottom:1px solid #EAF0FF;"><img src="cid:mensaly-logo" width="181" alt="Mensaly" style="display:block;width:181px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td class="mensaly-email-gutter" style="padding:32px 32px 12px;"><p style="margin:0 0 12px;color:#3B4DF6;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.9px;line-height:16px;text-transform:uppercase;">${input.eyebrow}</p><h1 style="margin:0;color:#0F172A;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.45px;line-height:34px;">${input.title}</h1></td></tr>
<tr><td class="mensaly-email-gutter" style="padding:8px 32px 28px;"><p style="margin:0;color:#475569;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;">${input.body}</p></td></tr>
${action}<tr><td class="mensaly-email-gutter" style="padding:20px 32px 28px;background-color:#F8FAFF;border-top:1px solid #EAF0FF;"><p style="margin:0;color:#64748B;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">${input.footerNote}</p></td></tr></table><p style="margin:18px 0 0;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;text-align:center;">Mensaly &middot; Gest&atilde;o simples para sua escola</p></td></tr></table></body></html>`;
}

export function renderTransactionalEmail(
  kind: TransactionalEmailKind,
  payload: { token?: string; name?: string },
  webAppUrl: string,
): EmailContent {
  if (kind === TransactionalEmailKind.WELCOME) {
    const name = payload.name ?? "cliente";
    const onboardingUrl = new URL("/onboarding", webAppUrl).toString();
    return {
      subject: "Configure seu negócio no Mensaly",
      html: emailLayout({
        eyebrow: "Pr&oacute;ximo passo",
        title: "Configure seu neg&oacute;cio",
        body: `Ol&aacute;, ${escapeHtml(name)}. Sua conta Mensaly foi confirmada. Agora conte um pouco sobre sua escola para come&ccedil;ar a organizar alunos, planos e cobran&ccedil;as.`,
        actionLabel: "Configurar meu negócio",
        actionUrl: onboardingUrl,
        footerNote: "Este link direciona voc&ecirc; para a configura&ccedil;&atilde;o inicial da sua conta Mensaly.",
      }),
      text: `Ol&aacute;, ${name}. Sua conta Mensaly foi confirmada. Configure seu neg&oacute;cio: ${onboardingUrl}`,
      attachments: [mensalyLogoAttachment()],
    };
  }
  if (!payload.token) throw new Error("Encrypted email token is missing");
  const path = kind === TransactionalEmailKind.PASSWORD_RESET ? "/redefinir-senha" : "/verificar-email";
  const url = new URL(path, webAppUrl);
  url.searchParams.set("token", payload.token);
  const isPasswordReset = kind === TransactionalEmailKind.PASSWORD_RESET;
  const label = isPasswordReset ? "Redefinir senha" : "Confirmar e-mail";
  return {
    subject: isPasswordReset ? "Redefina sua senha no Mensaly" : "Confirme seu e-mail no Mensaly",
    html: emailLayout({
      eyebrow: isPasswordReset ? "Seguran&ccedil;a da conta" : "Confirma&ccedil;&atilde;o de e-mail",
      title: isPasswordReset ? "Redefina sua senha" : "Confirme seu e-mail",
      body: isPasswordReset ? "Recebemos uma solicita&ccedil;&atilde;o para alterar a senha da sua conta. Use o bot&atilde;o abaixo para continuar." : "Para ativar sua conta e acessar o Mensaly, confirme seu endere&ccedil;o de e-mail.",
      actionLabel: label,
      actionUrl: url.toString(),
      footerNote: isPasswordReset ? "Se voc&ecirc; n&atilde;o solicitou a altera&ccedil;&atilde;o, ignore este e-mail. Sua senha continuar&aacute; a mesma." : "Se voc&ecirc; n&atilde;o criou uma conta no Mensaly, ignore este e-mail.",
    }),
    text: `${label}: ${url.toString()}`,
    attachments: [mensalyLogoAttachment()],
  };
}

function permanentStatus(status: number): boolean {
  return [400, 401, 403, 404, 422].includes(status);
}

export class EmailOutboxProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly configuration: WorkerEnvironment,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processDue(limit = 25): Promise<number> {
    if (this.configuration.EMAIL_DELIVERY_MODE !== "resend") return 0;
    const encryptionKey = this.configuration.EMAIL_ENCRYPTION_KEY;
    const apiKey = this.configuration.RESEND_API_KEY;
    const from = this.configuration.RESEND_FROM_EMAIL;
    if (!encryptionKey || !apiKey || !from) {
      throw new Error("Resend worker configuration is incomplete");
    }

    const now = this.now();
    await this.prisma.transactionalEmail.updateMany({
      where: {
        status: TransactionalEmailStatus.PROCESSING,
        lockedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
      },
      data: {
        status: TransactionalEmailStatus.FAILED_RETRYABLE,
        nextAttemptAt: now,
        lockedAt: null,
        lastErrorCode: "STALE_LOCK_RECOVERED",
      },
    });
    const candidates = await this.prisma.transactionalEmail.findMany({
      where: {
        status: {
          in: [
            TransactionalEmailStatus.PENDING,
            TransactionalEmailStatus.FAILED_RETRYABLE,
          ],
        },
        nextAttemptAt: { lte: now },
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: limit,
    });

    let processed = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.transactionalEmail.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          attemptCount: candidate.attemptCount,
        },
        data: {
          status: TransactionalEmailStatus.PROCESSING,
          lockedAt: now,
          attemptCount: { increment: 1 },
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (claimed.count !== 1) continue;
      processed += 1;

      try {
        const payload = decryptPayload<{ token?: string; name?: string }>(
          candidate.encryptedPayload as EncryptedPayload,
          encryptionKey,
        );
        const content = renderTransactionalEmail(
          candidate.kind,
          payload,
          this.configuration.WEB_APP_URL,
        );
        const response = await this.fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": candidate.idempotencyKey,
          },
          body: JSON.stringify({
            from: `Mensaly <${from}>`,
            to: [candidate.recipient],
            ...content,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const responseBody = (await response.json().catch(() => ({}))) as ResendResponse;
        if (!response.ok || !responseBody.id) {
          const error = new Error(
            responseBody.message ?? `Resend returned HTTP ${response.status}`,
          ) as Error & { permanent?: boolean; code?: string };
          error.permanent = permanentStatus(response.status);
          error.code = `RESEND_HTTP_${response.status}`;
          throw error;
        }
        await this.prisma.$transaction([
          this.prisma.transactionalEmail.update({
            where: { id: candidate.id },
            data: {
              status: TransactionalEmailStatus.SENT,
              providerMessageId: responseBody.id,
              sentAt: this.now(),
              lockedAt: null,
            },
          }),
          this.prisma.auditLog.create({
            data: {
              ...(candidate.userId ? { actorUserId: candidate.userId } : {}),
              actorType: candidate.userId
                ? AuditActorType.USER
                : AuditActorType.SYSTEM,
              action: "email.sent",
              entityType: "TransactionalEmail",
              entityId: candidate.id,
              after: {
                kind: candidate.kind,
                providerMessageId: responseBody.id,
              },
            },
          }),
        ]);
      } catch (unknownError) {
        const error = unknownError as Error & {
          permanent?: boolean;
          code?: string;
        };
        const attempt = candidate.attemptCount + 1;
        const terminal = error.permanent === true || attempt >= candidate.maxAttempts;
        const errorCode = (error.code ?? "EMAIL_DELIVERY_ERROR").slice(0, 120);
        const update = this.prisma.transactionalEmail.update({
          where: { id: candidate.id },
          data: {
            status: terminal
              ? TransactionalEmailStatus.FAILED_PERMANENT
              : TransactionalEmailStatus.FAILED_RETRYABLE,
            lockedAt: null,
            lastErrorCode: errorCode,
            lastErrorMessage: (error.message ?? "Unknown email error").slice(0, 1_000),
            nextAttemptAt: new Date(
              this.now().getTime() + Math.min(15 * 60_000, 2 ** attempt * 1_000),
            ),
          },
        });
        if (!terminal) {
          await update;
          continue;
        }
        await this.prisma.$transaction([
          update,
          this.prisma.auditLog.create({
            data: {
              ...(candidate.userId ? { actorUserId: candidate.userId } : {}),
              actorType: candidate.userId
                ? AuditActorType.USER
                : AuditActorType.SYSTEM,
              action: "email.failed",
              entityType: "TransactionalEmail",
              entityId: candidate.id,
              after: {
                kind: candidate.kind,
                errorCode,
                attempt,
              },
            },
          }),
        ]);
      }
    }
    return processed;
  }
}
