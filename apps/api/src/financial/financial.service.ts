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
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(referenceMonth)) {
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
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
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
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: {
        organizationId: orgId,
        status: EnrollmentStatus.ACTIVE,
        startDate: { lte: monthEnd(referenceMonth) },
        OR: [{ endDate: null }, { endDate: { gte: referenceMonth } }],
      },
      select: {
        id: true,
        amountCents: true,
        discountCents: true,
        dueDay: true,
      },
    });

    const charges = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge-generation:${orgId}:${input.referenceMonth}`}))`,
      );
      const generated = [];
      for (const enrollment of enrollments) {
        generated.push(
          await tx.charge.upsert({
            where: {
              organizationId_enrollmentId_referenceMonth: {
                organizationId: orgId,
                enrollmentId: enrollment.id,
                referenceMonth,
              },
            },
            create: {
              organizationId: orgId,
              enrollmentId: enrollment.id,
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

      return generated;
    });

    return {
      referenceMonth: input.referenceMonth,
      processed: enrollments.length,
      charges,
    };
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
          enrollment: { include: { student: true, guardian: true } },
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
        enrollment: { include: { student: true, guardian: true } },
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
        await tx.charge.update({
          where: { id: payment.chargeId, organizationId: orgId },
          data: { status: "PAID", paidAt: payment.paidAt },
        });
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
