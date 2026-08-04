import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encryptPayload } from "@mensaly/auth";
import {
  TransactionalEmailKind,
  TransactionalEmailStatus,
  type PrismaClient,
} from "@mensaly/database";
import type { WorkerEnvironment } from "@mensaly/config";

import {
  EmailOutboxProcessor,
  renderTransactionalEmail,
} from "./email-outbox.processor";

const key = Buffer.alloc(32, 3).toString("base64");
const configuration = {
  EMAIL_DELIVERY_MODE: "resend",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "noreply@example.test",
  EMAIL_ENCRYPTION_KEY: key,
  WEB_APP_URL: "https://app.example.test",
} as WorkerEnvironment;

function fakeDatabase() {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const email = {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    recipient: "owner@example.test",
    kind: TransactionalEmailKind.PASSWORD_RESET,
    encryptedPayload: encryptPayload({ token: "secret-token" }, key),
    idempotencyKey: "password-reset/test",
    status: TransactionalEmailStatus.PENDING,
    attemptCount: 0,
    maxAttempts: 4,
    nextAttemptAt: now,
    lockedAt: null,
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const audits: unknown[] = [];
  const transactionalEmail = {
    async updateMany(input: {
      where: { id?: string; status?: TransactionalEmailStatus };
      data: Record<string, unknown>;
    }) {
      if (!input.where.id) return { count: 0 };
      if (
        input.where.id !== email.id ||
        input.where.status !== email.status
      ) return { count: 0 };
      email.status = input.data.status as TransactionalEmailStatus;
      email.lockedAt = input.data.lockedAt as Date | null;
      if (input.data.attemptCount) email.attemptCount += 1;
      return { count: 1 };
    },
    async findMany() {
      return [email];
    },
    update(input: { data: Record<string, unknown> }) {
      Object.assign(email, input.data);
      return Promise.resolve(email);
    },
  };
  const auditLog = {
    create(input: unknown) {
      audits.push(input);
      return Promise.resolve(input);
    },
  };
  const prisma = {
    transactionalEmail,
    auditLog,
    async $transaction(operations: Promise<unknown>[]) {
      return Promise.all(operations);
    },
  } as unknown as PrismaClient;
  return { prisma, email, audits, now };
}

describe("transactional email outbox", () => {
  it("renders a branded, responsive and safe password reset email", () => {
    const content = renderTransactionalEmail(
      TransactionalEmailKind.PASSWORD_RESET,
      { token: "secret-token" },
      "https://app.example.test",
    );

    assert.equal(content.subject, "Redefina sua senha no Mensaly");
    assert.match(content.html, /Mensaly/);
    assert.match(content.html, /src="cid:mensaly-logo"/);
    assert.match(content.html, /#3B4DF6/);
    assert.match(content.html, /Redefinir senha/);
    assert.match(content.html, /https:\/\/app\.example\.test\/redefinir-senha\?token=secret-token/);
    assert.equal(content.attachments.length, 1);
    assert.equal(content.attachments[0]?.content_id, "mensaly-logo");
    assert.equal(content.attachments[0]?.content_type, "image/png");
  });

  it("escapes a welcome recipient name before rendering it in HTML", () => {
    const content = renderTransactionalEmail(
      TransactionalEmailKind.WELCOME,
      { name: '<img src=x onerror="alert(1)">' },
      "https://app.example.test",
    );

    assert.match(content.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.doesNotMatch(content.html, /<img src=x/);
    assert.equal(content.subject, "Configure seu negócio no Mensaly");
    assert.match(content.html, /Configurar meu negócio/);
    assert.match(content.html, /https:\/\/app\.example\.test\/onboarding/);
  });

  it("decrypts only inside the worker and marks a Resend delivery as sent", async () => {
    const database = fakeDatabase();
    let requestBody = "";
    let idempotencyKey = "";
    const fetcher: typeof fetch = async (_url, init) => {
      requestBody = String(init?.body);
      idempotencyKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
      return new Response(JSON.stringify({ id: "resend-message-1" }), {
        status: 200,
      });
    };
    const processor = new EmailOutboxProcessor(
      database.prisma,
      configuration,
      fetcher,
      () => database.now,
    );

    assert.equal(await processor.processDue(), 1);
    assert.equal(database.email.status, TransactionalEmailStatus.SENT);
    assert.equal(database.email.providerMessageId, "resend-message-1");
    assert.equal(idempotencyKey, "password-reset/test");
    assert.match(requestBody, /secret-token/);
    assert.equal(
      JSON.stringify(database.email.encryptedPayload).includes("secret-token"),
      false,
    );
    assert.equal(database.audits.length, 1);
  });

  it("schedules a limited retry after a provider outage", async () => {
    const database = fakeDatabase();
    const processor = new EmailOutboxProcessor(
      database.prisma,
      configuration,
      async () =>
        new Response(JSON.stringify({ message: "unavailable" }), {
          status: 503,
        }),
      () => database.now,
    );

    assert.equal(await processor.processDue(), 1);
    assert.equal(
      database.email.status,
      TransactionalEmailStatus.FAILED_RETRYABLE,
    );
    assert.equal(database.email.attemptCount, 1);
    assert.equal(database.email.lastErrorCode, "RESEND_HTTP_503");
  });

  it("marks a permanent provider rejection and audits it", async () => {
    const database = fakeDatabase();
    const processor = new EmailOutboxProcessor(
      database.prisma,
      configuration,
      async () =>
        new Response(JSON.stringify({ message: "invalid recipient" }), {
          status: 422,
        }),
      () => database.now,
    );

    assert.equal(await processor.processDue(), 1);
    assert.equal(
      database.email.status,
      TransactionalEmailStatus.FAILED_PERMANENT,
    );
    assert.equal(database.email.lastErrorCode, "RESEND_HTTP_422");
    assert.equal(database.audits.length, 1);
    assert.match(JSON.stringify(database.audits[0]), /email\.failed/);
  });
});
