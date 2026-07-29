import { Prisma } from "@mensaly/database";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Invalid calendar date");
  }
  return date;
}

function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async context(auth: AuthenticatedContext, asOf?: string) {
    const orgId = organizationId(auth);
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { timezone: true },
    });
    const date = dateOnly(asOf ?? localDate(organization.timezone));
    return { orgId, date };
  }

  async overview(auth: AuthenticatedContext, asOf?: string) {
    const { orgId, date } = await this.context(auth, asOf);
    const referenceMonth = monthStart(date);
    const [activeStudents, charges, received] = await Promise.all([
      this.prisma.client.student.count({
        where: { organizationId: orgId, status: "ACTIVE" },
      }),
      this.prisma.client.charge.findMany({
        where: { organizationId: orgId, referenceMonth },
        select: { status: true, finalAmountCents: true, dueDate: true },
      }),
      this.prisma.client.payment.aggregate({
        where: {
          organizationId: orgId,
          status: "CONFIRMED",
          paidAt: { gte: referenceMonth, lt: nextMonth(referenceMonth) },
        },
        _sum: { amountCents: true },
      }),
    ]);
    const collectible = charges.filter(
      (charge) => charge.status === "PENDING" || charge.status === "PAID",
    );
    const pending = charges.filter((charge) => charge.status === "PENDING");
    const overdue = pending.filter((charge) => charge.dueDate < date);
    return {
      asOf: date.toISOString().slice(0, 10),
      referenceMonth: monthKey(referenceMonth),
      activeStudents,
      expectedAmountCents: collectible.reduce(
        (sum, charge) => sum + charge.finalAmountCents,
        0,
      ),
      receivedAmountCents: received._sum.amountCents ?? 0,
      pendingAmountCents: pending.reduce(
        (sum, charge) => sum + charge.finalAmountCents,
        0,
      ),
      paidCharges: charges.filter((charge) => charge.status === "PAID").length,
      overdueCharges: overdue.length,
      delinquencyRate:
        collectible.length === 0
          ? 0
          : Number(((overdue.length / collectible.length) * 100).toFixed(2)),
    };
  }

  async upcoming(
    auth: AuthenticatedContext,
    query: { asOf?: string; days: number; limit: number },
  ) {
    const { orgId, date } = await this.context(auth, query.asOf);
    const items = await this.prisma.client.charge.findMany({
      where: {
        organizationId: orgId,
        status: "PENDING",
        dueDate: { gte: date, lte: addDays(date, query.days) },
      },
      include: {
        enrollment: {
          select: {
            student: { select: { id: true, name: true } },
            guardian: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: query.limit,
    });
    return items;
  }

  async recentPayments(auth: AuthenticatedContext, limit: number) {
    return this.prisma.client.payment.findMany({
      where: { organizationId: organizationId(auth), status: "CONFIRMED" },
      include: {
        charge: {
          select: {
            referenceMonth: true,
            enrollment: {
              select: { student: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  }

  async messageFailures(auth: AuthenticatedContext, limit: number) {
    return this.prisma.client.messageSchedule.findMany({
      where: {
        organizationId: organizationId(auth),
        status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] },
      },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        lastAttemptAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        recipientNameSnapshot: true,
        charge: {
          select: {
            id: true,
            enrollment: {
              select: { student: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: [{ lastAttemptAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  }

  async evolution(
    auth: AuthenticatedContext,
    query: { asOf?: string; months: number },
  ) {
    const { orgId, date } = await this.context(auth, query.asOf);
    const end = nextMonth(monthStart(date));
    const start = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() - query.months + 1,
        1,
      ),
    );
    const [chargeRows, paymentRows] = await Promise.all([
      this.prisma.client.$queryRaw<
        Array<{
          month: Date;
          expected: bigint;
          pending: bigint;
          paid: bigint;
          overdue: bigint;
        }>
      >(Prisma.sql`
        SELECT date_trunc('month', "referenceMonth") AS month,
          COALESCE(SUM("finalAmountCents") FILTER (WHERE status IN ('PENDING', 'PAID')), 0) AS expected,
          COALESCE(SUM("finalAmountCents") FILTER (WHERE status = 'PENDING'), 0) AS pending,
          COUNT(*) FILTER (WHERE status = 'PAID') AS paid,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND "dueDate" < ${date}) AS overdue
        FROM "charge"
        WHERE "organizationId" = ${orgId}::uuid
          AND "referenceMonth" >= ${start}
          AND "referenceMonth" < ${end}
        GROUP BY 1
      `),
      this.prisma.client.$queryRaw<
        Array<{ month: Date; received: bigint }>
      >(Prisma.sql`
        SELECT date_trunc('month', "paidAt") AS month,
          COALESCE(SUM("amountCents"), 0) AS received
        FROM "payment"
        WHERE "organizationId" = ${orgId}::uuid
          AND status = 'CONFIRMED'
          AND "paidAt" >= ${start}
          AND "paidAt" < ${end}
        GROUP BY 1
      `),
    ]);
    const charges = new Map(
      chargeRows.map((row) => [monthKey(row.month), row]),
    );
    const payments = new Map(
      paymentRows.map((row) => [monthKey(row.month), row]),
    );
    return Array.from({ length: query.months }, (_, index) => {
      const month = new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth() + index,
          1,
        ),
      );
      const key = monthKey(month);
      const charge = charges.get(key);
      const payment = payments.get(key);
      return {
        month: key,
        expectedAmountCents: Number(charge?.expected ?? 0),
        receivedAmountCents: Number(payment?.received ?? 0),
        pendingAmountCents: Number(charge?.pending ?? 0),
        paidCharges: Number(charge?.paid ?? 0),
        overdueCharges: Number(charge?.overdue ?? 0),
      };
    });
  }
}
