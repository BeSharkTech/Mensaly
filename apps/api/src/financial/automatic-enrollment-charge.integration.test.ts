import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  disconnectPrismaClient,
  getPrismaClient,
  UserRole,
  UserStatus,
} from "@mensaly/database";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { OperationalService } from "../operational/operational.service";
import { FinancialService } from "./financial.service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Automatic enrollment charge tests require the isolated mensaly_test database.");
}

function localDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(date: string, offsetDays: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function monthBounds(date: string) {
  const [year, month] = date.split("-").map(Number);
  return {
    first: `${year}-${String(month).padStart(2, "0")}-01`,
    last: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

describe("Automatic charges for a new enrollment", () => {
  it("refuses to create a billing rule until Mercado Pago is connected", async () => {
    const prisma = getPrismaClient();
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: {
        name: "No Gateway Owner",
        email: `no-gateway-${suffix}@example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await prisma.organization.create({
      data: { ownerUserId: owner.id, name: `No Gateway ${suffix}` },
    });
    const financial = new FinancialService(new PrismaService());
    const auth: AuthenticatedContext = {
      userId: owner.id,
      email: owner.email,
      role: "COMPANY_ACCOUNT",
      organizationId: organization.id,
    };

    await assert.rejects(
      financial.createBillingRule(auth, {
        name: "Cobrança bloqueada",
        sourceType: "PLAN",
        sourceId: randomUUID(),
        frequency: "ONCE",
        opensOn: localDate("America/Sao_Paulo"),
        expiresOn: localDate("America/Sao_Paulo"),
        studentIds: [],
      }, `no-gateway-${suffix}`),
      (error: unknown) => JSON.stringify(error).includes("MERCADOPAGO_ACCOUNT_NOT_CONNECTED"),
    );
    assert.equal(
      await prisma.billingRule.count({ where: { organizationId: organization.id } }),
      0,
    );
  });

  it("creates every active plan rule once, respects expiry inclusively, and uses the custom enrollment value", async () => {
    const prisma = getPrismaClient();
    const suffix = randomUUID();
    const timezone = "America/Sao_Paulo";
    const today = localDate(timezone);
    const { first, last } = monthBounds(today);
    const owner = await prisma.user.create({
      data: {
        name: "Automatic Charge Owner",
        email: `automatic-charge-${suffix}@example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await prisma.organization.create({
      data: { ownerUserId: owner.id, name: `Automatic Charge ${suffix}`, timezone },
    });
    await prisma.mercadoPagoConnection.create({
      data: {
        organizationId: organization.id,
        mercadoPagoUserId: `automatic-charge-${suffix}`,
        publicKey: "TEST-public-key",
        encryptedAccessToken: { version: 1 },
        encryptedRefreshToken: { version: 1 },
        status: "CONNECTED",
        liveMode: false,
        scopes: "payments write",
        tokenExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
      },
    });
    const plan = await prisma.plan.create({
      data: {
        organizationId: organization.id,
        name: "Plano com valor personalizado",
        amountCents: 10_000,
        dueDay: 10,
      },
    });
    const student = await prisma.student.create({
      data: { organizationId: organization.id, name: "Aluno automático", cpf: `9${Date.now().toString().slice(-10)}` },
    });
    const guardian = await prisma.guardian.create({
      data: { organizationId: organization.id, name: "Responsável automático", taxId: `8${Date.now().toString().slice(-10)}`, phone: "11999999999" },
    });
    await prisma.studentGuardian.create({
      data: { organizationId: organization.id, studentId: student.id, guardianId: guardian.id, relationship: "Responsável" },
    });
    const createRule = (name: string, frequency: "ONCE" | "MONTHLY", opensOn: string, expiresOn: string, repeatUntil?: string) =>
      prisma.billingRule.create({
        data: {
          organizationId: organization.id,
          name,
          sourceType: "PLAN",
          sourceId: plan.id,
          sourceNameSnapshot: plan.name,
          amountCents: plan.amountCents,
          idempotencyKey: `${name}-${suffix}`,
          frequency,
          opensOn: new Date(`${opensOn}T00:00:00.000Z`),
          expiresOn: new Date(`${expiresOn}T00:00:00.000Z`),
          ...(repeatUntil ? { repeatUntil: new Date(`${repeatUntil}T00:00:00.000Z`) } : {}),
        },
      });
    await Promise.all([
      createRule("Única aberta", "ONCE", first, last),
      createRule("Única no vencimento", "ONCE", shiftDate(today, -3), today),
      createRule("Mensal aberta", "MONTHLY", first, last, shiftDate(today, 365)),
      createRule("Única vencida", "ONCE", shiftDate(today, -5), shiftDate(today, -1)),
      createRule("Única futura", "ONCE", shiftDate(today, 1), shiftDate(today, 5)),
    ]);

    const financial = new FinancialService(new PrismaService());
    const operational = new OperationalService(new PrismaService(), financial);
    const auth: AuthenticatedContext = {
      userId: owner.id,
      email: owner.email,
      role: "COMPANY_ACCOUNT",
      organizationId: organization.id,
    };
    const enrollment = await operational.createEnrollment(auth, {
      studentId: student.id,
      guardianId: guardian.id,
      planId: plan.id,
      amountCents: 9_300,
      discountCents: 300,
      startDate: today,
    });
    const charges = await prisma.charge.findMany({
      where: { organizationId: organization.id, enrollmentId: enrollment.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(charges.length, 3);
    assert.deepEqual(charges.map((charge) => charge.finalAmountCents), [9_000, 9_000, 9_000]);

    await prisma.$transaction((tx) => financial.createAutomaticChargesForEnrollment(tx, {
      organizationId: organization.id,
      enrollment,
      timezone,
      actorUserId: owner.id,
    }));
    assert.equal(await prisma.charge.count({ where: { organizationId: organization.id, enrollmentId: enrollment.id } }), 3);
  });
});

after(async () => {
  await disconnectPrismaClient();
});
