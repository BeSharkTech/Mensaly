import {
  AuditActorType,
  EnrollmentStatus,
  type Payment,
  Prisma,
} from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type {
  ChargeListQuery,
  CreateBillingRuleInput,
  CreateManualChargeInput,
  CreateManualPaymentInput,
  GenerateChargesInput,
} from "./financial.dto";

export type FinancialAuditMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function monthStart(referenceMonth: string): Date {
  if (!/^(?:20\d{2}|[3-9]\d{3})-(0[1-9]|1[0-2])$/.test(referenceMonth)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "referenceMonth must use YYYY-MM",
    });
  }
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function dueDate(referenceMonth: Date, dueDay: number): Date {
  const year = referenceMonth.getUTCFullYear();
  const month = referenceMonth.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dueDay, lastDay)));
}

function monthEnd(referenceMonth: Date): Date {
  return new Date(
    Date.UTC(
      referenceMonth.getUTCFullYear(),
      referenceMonth.getUTCMonth() + 1,
      0,
    ),
  );
}

function paymentMatches(
  payment: Payment,
  chargeId: string,
  input: CreateManualPaymentInput,
): boolean {
  return (
    payment.chargeId === chargeId &&
    payment.amountCents === input.amountCents &&
    payment.method === input.method &&
    payment.paidAt.getTime() === new Date(input.paidAt).getTime() &&
    payment.externalReference === (input.externalReference ?? null) &&
    payment.notes === (input.notes ?? null)
  );
}

function auditMetadata(
  metadata: FinancialAuditMetadata,
): FinancialAuditMetadata {
  return {
    ...(metadata.correlationId
      ? { correlationId: metadata.correlationId }
      : {}),
    ...(metadata.ipAddress
      ? { ipAddress: metadata.ipAddress.slice(0, 64) }
      : {}),
    ...(metadata.userAgent
      ? { userAgent: metadata.userAgent.slice(0, 1_024) }
      : {}),
  };
}

@Injectable()
export class FinancialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async generateCharges(
    auth: AuthenticatedContext,
    input: GenerateChargesInput,
    metadata: FinancialAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const referenceMonth = monthStart(input.referenceMonth);
    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge-generation:${orgId}:${input.referenceMonth}`}))`,
      );
      const enrollments = await tx.$queryRaw<
        Array<{
          id: string;
          amountCents: number;
          discountCents: number;
          dueDay: number;
        }>
      >(Prisma.sql`
        SELECT e."id", e."amountCents", e."discountCents", e."dueDay"
        FROM "enrollment" e
        INNER JOIN "student" s
          ON s."organizationId" = e."organizationId" AND s."id" = e."studentId"
        INNER JOIN "plan" p
          ON p."organizationId" = e."organizationId" AND p."id" = e."planId"
        WHERE e."organizationId" = ${orgId}::uuid
          AND e."status" = ${EnrollmentStatus.ACTIVE}::"EnrollmentStatus"
          AND s."status" = 'ACTIVE'::"StudentStatus"
          AND p."status" = 'ACTIVE'::"PlanStatus"
          AND e."startDate" <= ${monthEnd(referenceMonth)}
          AND (e."endDate" IS NULL OR e."endDate" >= ${referenceMonth})
        FOR SHARE
      `);
      const generated = [];
      for (const enrollment of enrollments) {
        generated.push(
          await tx.charge.upsert({
            where: {
              organizationId_enrollmentId_cycleKey: {
                organizationId: orgId,
                enrollmentId: enrollment.id,
                cycleKey: `legacy:${input.referenceMonth}`,
              },
            },
            create: {
              organizationId: orgId,
              enrollmentId: enrollment.id,
              cycleKey: `legacy:${input.referenceMonth}`,
              referenceMonth,
              dueDate: dueDate(referenceMonth, enrollment.dueDay),
              amountCents: enrollment.amountCents,
              discountCents: enrollment.discountCents,
              finalAmountCents:
                enrollment.amountCents - enrollment.discountCents,
            },
            update: {},
          }),
        );
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "charge.generation_requested",
          entityType: "ChargeGeneration",
          after: {
            referenceMonth: input.referenceMonth,
            enrollmentCount: enrollments.length,
          },
          ...auditMetadata(metadata),
        },
      });

      return { charges: generated, processed: enrollments.length };
    });

    return {
      referenceMonth: input.referenceMonth,
      processed: result.processed,
      charges: result.charges,
    };
  }

  async createManualCharge(
    auth: AuthenticatedContext,
    input: CreateManualChargeInput,
    metadata: FinancialAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const referenceMonth = monthStart(input.referenceMonth);
    return this.prisma.client.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: {
          organizationId: orgId,
          studentId: input.studentId,
          status: EnrollmentStatus.ACTIVE,
          startDate: { lte: monthEnd(referenceMonth) },
          OR: [{ endDate: null }, { endDate: { gte: referenceMonth } }],
          student: { status: "ACTIVE" },
          plan: { status: "ACTIVE" },
        },
        select: {
          id: true,
          amountCents: true,
          discountCents: true,
          dueDay: true,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!enrollment) {
        throw new NotFoundException({
          code: "ACTIVE_ENROLLMENT_NOT_FOUND",
          message: "The selected student has no active enrollment",
        });
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge-generation:${orgId}:${input.referenceMonth}`}))`,
      );
      const existing = await tx.charge.findUnique({
        where: {
          organizationId_enrollmentId_cycleKey: {
            organizationId: orgId,
            enrollmentId: enrollment.id,
            cycleKey: `legacy:${input.referenceMonth}`,
          },
        },
      });
      if (existing) return { charge: existing, created: false };

      const charge = await tx.charge.create({
        data: {
          organizationId: orgId,
          enrollmentId: enrollment.id,
          cycleKey: `legacy:${input.referenceMonth}`,
          referenceMonth,
          dueDate: dueDate(referenceMonth, enrollment.dueDay),
          amountCents: enrollment.amountCents,
          discountCents: enrollment.discountCents,
          finalAmountCents: enrollment.amountCents - enrollment.discountCents,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "charge.manual_created",
          entityType: "Charge",
          entityId: charge.id,
          after: { studentId: input.studentId, enrollmentId: enrollment.id, referenceMonth: input.referenceMonth },
          ...auditMetadata(metadata),
        },
      });
      return { charge, created: true };
    });
  }

  async billingRules(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    return this.prisma.client.billingRule.findMany({
      where: { organizationId: orgId },
      include: {
        targets: {
          include: { student: { select: { id: true, name: true } } },
          orderBy: { student: { name: "asc" } },
        },
        _count: { select: { charges: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createBillingRule(
    auth: AuthenticatedContext,
    input: CreateBillingRuleInput,
    idempotencyKey: string,
    metadata: FinancialAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const studentIds = [...new Set(input.studentIds)];
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-rule:${orgId}:${idempotencyKey}`}))`);
      const existing = await tx.billingRule.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey } },
        include: { targets: { select: { studentId: true } } },
      });
      if (existing) {
        const existingStudents = existing.targets.map(({ studentId }) => studentId).sort();
        const requestedStudents = [...studentIds].sort();
        const sameRequest =
          existing.name === input.name &&
          existing.sourceType === input.sourceType &&
          existing.sourceId === input.sourceId &&
          existing.frequency === input.frequency &&
          existing.opensOn.toISOString().slice(0, 10) === input.opensOn &&
          existing.expiresOn.toISOString().slice(0, 10) === input.expiresOn &&
          (existing.repeatUntil?.toISOString().slice(0, 10) ?? null) === (input.repeatUntil ?? null) &&
          existingStudents.length === requestedStudents.length &&
          existingStudents.every((studentId, index) => studentId === requestedStudents[index]);
        if (!sameRequest) {
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "The idempotency key was already used with different billing rule data",
          });
        }
        return { rule: existing, chargesCreated: 0, replayed: true };
      }
      const source = input.sourceType === "PLAN"
        ? await tx.plan.findFirst({ where: { id: input.sourceId, organizationId: orgId, status: "ACTIVE" }, select: { id: true, name: true, amountCents: true } })
        : input.sourceType === "PRODUCT"
          ? await tx.product.findFirst({ where: { id: input.sourceId, organizationId: orgId, status: "ACTIVE" }, select: { id: true, name: true, priceCents: true } })
          : await tx.event.findFirst({ where: { id: input.sourceId, organizationId: orgId, status: "ACTIVE" }, select: { id: true, name: true, priceCents: true } });
      if (!source) {
        throw new NotFoundException({ code: "BILLING_SOURCE_NOT_FOUND", message: "The selected billing source was not found" });
      }
      const amountCents = "amountCents" in source ? source.amountCents : source.priceCents;
      const enrollments = await tx.enrollment.findMany({
        where: {
          organizationId: orgId,
          studentId: { in: studentIds },
          status: EnrollmentStatus.ACTIVE,
          student: { status: "ACTIVE" },
          plan: { status: "ACTIVE" },
          ...(input.sourceType === "PLAN" ? { planId: input.sourceId } : {}),
        },
        select: { id: true, studentId: true },
      });
      if (new Set(enrollments.map((item) => item.studentId)).size !== studentIds.length) {
        throw new BadRequestException({
          code: "BILLING_TARGET_INVALID",
          message: input.sourceType === "PLAN"
            ? "Every selected student must have an active enrollment in the selected plan"
            : "Every selected student must have an active enrollment",
        });
      }
      const rule = await tx.billingRule.create({
        data: {
          organizationId: orgId,
          name: input.name,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceNameSnapshot: source.name,
          amountCents,
          idempotencyKey,
          frequency: input.frequency,
          opensOn: new Date(`${input.opensOn}T00:00:00.000Z`),
          expiresOn: new Date(`${input.expiresOn}T00:00:00.000Z`),
          ...(input.repeatUntil ? { repeatUntil: new Date(`${input.repeatUntil}T00:00:00.000Z`) } : {}),
        },
      });
      await tx.billingRuleTarget.createMany({
        data: studentIds.map((studentId) => ({ organizationId: orgId, billingRuleId: rule.id, studentId })),
      });
      const created = await this.materializeBillingRule(tx, rule, new Date());
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "billing_rule.created",
          entityType: "BillingRule",
          entityId: rule.id,
          after: { sourceType: rule.sourceType, sourceId: rule.sourceId, frequency: rule.frequency, targetCount: studentIds.length, chargesCreated: created },
          ...auditMetadata(metadata),
        },
      });
      return { rule, chargesCreated: created, replayed: false };
    });
  }

  async deactivateBillingRule(auth: AuthenticatedContext, id: string, metadata: FinancialAuditMetadata = {}) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.billingRule.findFirst({ where: { id, organizationId: orgId } });
      if (!current) throw new NotFoundException({ code: "BILLING_RULE_NOT_FOUND", message: "Billing rule was not found" });
      const rule = await tx.billingRule.update({ where: { id }, data: { status: "INACTIVE" } });
      await tx.auditLog.create({ data: { organizationId: orgId, actorUserId: auth.userId, actorType: AuditActorType.USER, action: "billing_rule.deactivated", entityType: "BillingRule", entityId: id, ...auditMetadata(metadata) } });
      return rule;
    });
  }

  async processBillingRules(auth: AuthenticatedContext, metadata: FinancialAuditMetadata = {}) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-rules:${orgId}`}))`);
      const rules = await tx.billingRule.findMany({ where: { organizationId: orgId, status: "ACTIVE" } });
      let created = 0;
      for (const rule of rules) created += await this.materializeBillingRule(tx, rule, new Date());
      await tx.auditLog.create({ data: { organizationId: orgId, actorUserId: auth.userId, actorType: AuditActorType.USER, action: "billing_rule.processing_requested", entityType: "BillingRule", after: { created }, ...auditMetadata(metadata) } });
      return { created };
    });
  }

  private async materializeBillingRule(
    tx: Prisma.TransactionClient,
    rule: { id: string; organizationId: string; sourceType: "PLAN" | "PRODUCT" | "EVENT"; sourceId: string; amountCents: number; frequency: "MONTHLY" | "ONCE"; opensOn: Date; expiresOn: Date; repeatUntil: Date | null },
    now: Date,
  ): Promise<number> {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let cycleKey: string;
    let referenceMonth: Date;
    let expiresAt: Date;
    if (rule.frequency === "ONCE") {
      if (today < rule.opensOn) return 0;
      cycleKey = `rule:${rule.id}:once`;
      referenceMonth = new Date(Date.UTC(rule.opensOn.getUTCFullYear(), rule.opensOn.getUTCMonth(), 1));
      expiresAt = rule.expiresOn;
    } else {
      if (today < rule.opensOn || (rule.repeatUntil && today > rule.repeatUntil)) return 0;
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth();
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const opensAt = new Date(Date.UTC(year, month, Math.min(rule.opensOn.getUTCDate(), lastDay)));
      if (today < opensAt) return 0;
      const monthOffset = (rule.expiresOn.getUTCFullYear() * 12 + rule.expiresOn.getUTCMonth()) - (rule.opensOn.getUTCFullYear() * 12 + rule.opensOn.getUTCMonth());
      const dueMonth = month + Math.max(0, monthOffset);
      const dueLastDay = new Date(Date.UTC(year, dueMonth + 1, 0)).getUTCDate();
      expiresAt = new Date(Date.UTC(year, dueMonth, Math.min(rule.expiresOn.getUTCDate(), dueLastDay)));
      referenceMonth = new Date(Date.UTC(year, month, 1));
      cycleKey = `rule:${rule.id}:${year}-${String(month + 1).padStart(2, "0")}`;
    }
    const targets = await tx.billingRuleTarget.findMany({ where: { organizationId: rule.organizationId, billingRuleId: rule.id }, select: { studentId: true } });
    const enrollments = await tx.enrollment.findMany({
      where: {
        organizationId: rule.organizationId,
        studentId: { in: targets.map((target) => target.studentId) },
        status: EnrollmentStatus.ACTIVE,
        student: { status: "ACTIVE" },
        plan: { status: "ACTIVE" },
        ...(rule.sourceType === "PLAN" ? { planId: rule.sourceId } : {}),
      },
      distinct: ["studentId"],
      orderBy: { createdAt: "desc" },
      select: { id: true, amountCents: true, discountCents: true },
    });
    const result = await tx.charge.createMany({
      data: enrollments.map((enrollment) => {
        const amountCents = rule.sourceType === "PLAN" ? enrollment.amountCents : rule.amountCents;
        const discountCents = rule.sourceType === "PLAN" ? enrollment.discountCents : 0;
        return { organizationId: rule.organizationId, enrollmentId: enrollment.id, billingRuleId: rule.id, cycleKey, referenceMonth, dueDate: expiresAt, amountCents, discountCents, finalAmountCents: amountCents - discountCents };
      }),
      skipDuplicates: true,
    });
    return result.count;
  }

  async charges(auth: AuthenticatedContext, query: ChargeListQuery) {
    const orgId = organizationId(auth);
    const referenceMonth = query.referenceMonth
      ? monthStart(query.referenceMonth)
      : undefined;
    const where = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(referenceMonth ? { referenceMonth } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.charge.findMany({
        where,
        include: {
          billingRule: true,
          enrollment: {
            include: { student: true, guardian: true, plan: true },
          },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.charge.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async charge(auth: AuthenticatedContext, id: string) {
    const item = await this.prisma.client.charge.findFirst({
      where: { id, organizationId: organizationId(auth) },
      include: {
        billingRule: true,
        enrollment: {
          include: { student: true, guardian: true, plan: true },
        },
        payments: { orderBy: [{ paidAt: "desc" }, { id: "asc" }] },
      },
    });
    if (!item) {
      throw new NotFoundException({
        code: "RESOURCE_NOT_FOUND",
        message: "Resource was not found",
      });
    }
    return item;
  }

  async changeChargeStatus(
    auth: AuthenticatedContext,
    id: string,
    target: "CANCELLED" | "WAIVED" | "PENDING",
    metadata: FinancialAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${id}`}))`,
      );
      const current = await tx.charge.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!current) {
        throw new NotFoundException({
          code: "RESOURCE_NOT_FOUND",
          message: "Resource was not found",
        });
      }

      const allowed =
        target === "PENDING"
          ? current.status === "CANCELLED" || current.status === "WAIVED"
          : current.status === "PENDING";
      if (!allowed) {
        throw new ConflictException({
          code: "CHARGE_STATE_CONFLICT",
          message: "This charge cannot transition from its current state",
        });
      }

      if (target !== "PENDING") {
        const activePayment = await tx.payment.findFirst({
          where: {
            organizationId: orgId,
            chargeId: id,
            status: { in: ["PENDING_RECONCILIATION", "CONFIRMED"] },
          },
          select: { id: true },
        });
        if (activePayment) {
          throw new ConflictException({
            code: "CHARGE_HAS_ACTIVE_PAYMENT",
            message: "A charge with an active payment cannot be changed",
          });
        }
      }

      const now = new Date();
      const updated = await tx.charge.update({
        where: { id, organizationId: orgId },
        data: {
          status: target,
          cancelledAt: target === "CANCELLED" ? now : null,
          waivedAt: target === "WAIVED" ? now : null,
          paidAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: `charge.${target.toLowerCase()}`,
          entityType: "Charge",
          entityId: id,
          before: { status: current.status },
          after: { status: updated.status },
          ...auditMetadata(metadata),
        },
      });
      return updated;
    });
  }

  async createManualPayment(
    auth: AuthenticatedContext,
    chargeId: string,
    idempotencyKey: string,
    input: CreateManualPaymentInput,
    metadata: FinancialAuditMetadata = {},
  ): Promise<{ payment: Payment; replayed: boolean }> {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment-idempotency:${orgId}:${idempotencyKey}`}))`,
      );

      const existing = await tx.payment.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: orgId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        if (!paymentMatches(existing, chargeId, input)) {
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message:
              "The idempotency key was already used with different payment data",
          });
        }
        return { payment: existing, replayed: true };
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${chargeId}`}))`,
      );
      const charge = await tx.charge.findFirst({
        where: { id: chargeId, organizationId: orgId },
      });
      if (!charge) {
        throw new NotFoundException({
          code: "RESOURCE_NOT_FOUND",
          message: "Resource was not found",
        });
      }
      if (charge.status !== "PENDING") {
        throw new ConflictException({
          code: "CHARGE_STATE_CONFLICT",
          message: "Only pending charges can receive a payment",
        });
      }
      if (input.amountCents !== charge.finalAmountCents) {
        throw new BadRequestException({
          code: "PAYMENT_AMOUNT_MISMATCH",
          message: "Payment amount must equal the charge balance",
        });
      }

      const activePayment = await tx.payment.findFirst({
        where: {
          organizationId: orgId,
          chargeId,
          status: { in: ["PENDING_RECONCILIATION", "CONFIRMED"] },
        },
        select: { id: true },
      });
      if (activePayment) {
        throw new ConflictException({
          code: "PAYMENT_ALREADY_EXISTS",
          message: "This charge already has an active payment",
        });
      }

      const payment = await tx.payment.create({
        data: {
          organizationId: orgId,
          chargeId,
          idempotencyKey,
          amountCents: input.amountCents,
          method: input.method,
          paidAt: new Date(input.paidAt),
          externalReference: input.externalReference,
          notes: input.notes,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "payment.created",
          entityType: "Payment",
          entityId: payment.id,
          after: {
            chargeId,
            amountCents: payment.amountCents,
            status: payment.status,
            idempotencyKey,
          },
          ...auditMetadata(metadata),
        },
      });
      return { payment, replayed: false };
    });
  }

  async changePaymentStatus(
    auth: AuthenticatedContext,
    id: string,
    target: "CONFIRMED" | "CANCELLED" | "REVERSED",
    metadata: FinancialAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const candidate = await tx.payment.findFirst({
        where: { id, organizationId: orgId },
        select: { chargeId: true },
      });
      if (!candidate) {
        throw new NotFoundException({
          code: "RESOURCE_NOT_FOUND",
          message: "Resource was not found",
        });
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${candidate.chargeId}`}))`,
      );
      const payment = await tx.payment.findFirst({
        where: { id, organizationId: orgId },
        include: { charge: true },
      });
      if (!payment) {
        throw new NotFoundException({
          code: "RESOURCE_NOT_FOUND",
          message: "Resource was not found",
        });
      }

      const allowed =
        target === "CONFIRMED"
          ? payment.status === "PENDING_RECONCILIATION" &&
            payment.charge.status === "PENDING"
          : target === "CANCELLED"
            ? payment.status === "PENDING_RECONCILIATION"
            : payment.status === "CONFIRMED" &&
              payment.charge.status === "PAID";
      if (!allowed) {
        throw new ConflictException({
          code: "PAYMENT_STATE_CONFLICT",
          message: "This payment cannot transition from its current state",
        });
      }

      const updated = await tx.payment.update({
        where: { id, organizationId: orgId },
        data: {
          status: target,
          reversedAt: target === "REVERSED" ? new Date() : null,
        },
      });
      if (target === "CONFIRMED") {
        const cancelledAt = new Date();
        await tx.charge.update({
          where: { id: payment.chargeId, organizationId: orgId },
          data: { status: "PAID", paidAt: payment.paidAt },
        });
        const schedules = await tx.messageSchedule.findMany({
          where: {
            organizationId: orgId,
            chargeId: payment.chargeId,
            status: { in: ["SCHEDULED", "QUEUED"] },
          },
          select: { id: true, status: true },
        });
        if (schedules.length > 0) {
          await tx.messageSchedule.updateMany({
            where: {
              id: { in: schedules.map((schedule) => schedule.id) },
              organizationId: orgId,
              status: { in: ["SCHEDULED", "QUEUED"] },
            },
            data: {
              status: "CANCELLED",
              cancelledAt,
              cancellationReason: "CHARGE_PAID",
            },
          });
          await tx.messageScheduleHistory.createMany({
            data: schedules.map((schedule) => ({
              organizationId: orgId,
              scheduleId: schedule.id,
              fromStatus: schedule.status,
              toStatus: "CANCELLED",
              reason: "CHARGE_PAID",
              metadata: { paymentId: updated.id },
            })),
          });
        }
      }
      if (target === "REVERSED") {
        await tx.charge.update({
          where: { id: payment.chargeId, organizationId: orgId },
          data: { status: "PENDING", paidAt: null },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: `payment.${target.toLowerCase()}`,
          entityType: "Payment",
          entityId: id,
          before: {
            paymentStatus: payment.status,
            chargeStatus: payment.charge.status,
          },
          after: {
            paymentStatus: updated.status,
            chargeStatus:
              target === "CONFIRMED"
                ? "PAID"
                : target === "REVERSED"
                  ? "PENDING"
                  : payment.charge.status,
          },
          ...auditMetadata(metadata),
        },
      });
      return updated;
    });
  }
}
