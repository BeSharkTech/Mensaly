import { Prisma } from "@mensaly/database";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { adminInsightsConfiguration } from "./admin-insights.configuration";
import { SentryInsightsClient } from "./sentry-insights.client";

type MonthlyRow = { month: Date; value: bigint | number };

function monthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

function monthStarts(months: number): Date[] {
  const current = new Date();
  const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  return Array.from({ length: months }, (_, index) =>
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - (months - index - 1), 1)),
  );
}

@Injectable()
export class AdminInsightsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SentryInsightsClient) private readonly sentry: SentryInsightsClient,
  ) {}

  async analytics(query: { days: number; months: number }) {
    const months = monthStarts(query.months);
    const firstMonth = months[0] ?? new Date();
    const currentMonth = months.at(-1) ?? new Date();
    const nextMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1));
    const [createdBefore, organizationRows, chargeRows, paymentRows, organizations, storageRows, emailRows, sentry] =
      await Promise.all([
        this.prisma.client.organization.count({ where: { createdAt: { lt: firstMonth } } }),
        this.prisma.client.$queryRaw<MonthlyRow[]>(Prisma.sql`
          SELECT date_trunc('month', "createdAt") AS month, count(*)::bigint AS value
          FROM "organization"
          WHERE "createdAt" >= ${firstMonth} AND "createdAt" < ${nextMonth}
          GROUP BY 1 ORDER BY 1
        `),
        this.prisma.client.$queryRaw<Array<{ month: Date; billed: bigint | number }>>(Prisma.sql`
          SELECT date_trunc('month', "referenceMonth") AS month,
                 COALESCE(sum("finalAmountCents"), 0)::bigint AS billed
          FROM "charge"
          WHERE "referenceMonth" >= ${firstMonth} AND "referenceMonth" < ${nextMonth}
            AND status <> 'CANCELLED'
          GROUP BY 1 ORDER BY 1
        `),
        this.prisma.client.$queryRaw<Array<{ month: Date; received: bigint | number }>>(Prisma.sql`
          SELECT date_trunc('month', "paidAt") AS month,
                 COALESCE(sum("amountCents"), 0)::bigint AS received
          FROM "payment"
          WHERE "paidAt" >= ${firstMonth} AND "paidAt" < ${nextMonth}
            AND status = 'CONFIRMED'
          GROUP BY 1 ORDER BY 1
        `),
        this.prisma.client.organization.findMany({
          select: { id: true, name: true, status: true, ownerUserId: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
        this.prisma.client.storedFile.groupBy({
          by: ["organizationId"],
          where: { status: "ACTIVE" },
          _sum: { sizeBytes: true },
        }),
        this.prisma.client.transactionalEmail.groupBy({
          by: ["userId"],
          where: { createdAt: { gte: currentMonth, lt: nextMonth }, userId: { not: null } },
          _count: { _all: true },
        }),
        this.sentry.summary(query.days),
      ]);

    const created = new Map(organizationRows.map((row) => [monthKey(row.month), Number(row.value)]));
    const billed = new Map(chargeRows.map((row) => [monthKey(row.month), Number(row.billed)]));
    const received = new Map(paymentRows.map((row) => [monthKey(row.month), Number(row.received)]));
    let cumulativeOrganizations = createdBefore;
    const trends = months.map((month) => {
      const key = monthKey(month);
      const newOrganizations = created.get(key) ?? 0;
      cumulativeOrganizations += newOrganizations;
      return {
        month: key,
        newOrganizations,
        totalOrganizations: cumulativeOrganizations,
        billedCents: billed.get(key) ?? 0,
        receivedCents: received.get(key) ?? 0,
      };
    });

    const configuration = adminInsightsConfiguration();
    const activeOrganizations = organizations.filter((item) => item.status === "ACTIVE").length;
    const fixedCostDivisor = Math.max(activeOrganizations, 1);
    const fixedShareCents = Math.round(configuration.monthlyFixedCostCents / fixedCostDivisor);
    const storage = new Map(storageRows.map((row) => [row.organizationId, row._sum.sizeBytes ?? 0]));
    const emails = new Map(emailRows.filter((row) => row.userId).map((row) => [row.userId as string, row._count._all]));
    const costs = organizations.map((organization) => {
      const storageBytes = storage.get(organization.id) ?? 0;
      const emailCount = emails.get(organization.ownerUserId) ?? 0;
      const storageCostCents = Math.round(
        (storageBytes / 1024 ** 3) * configuration.storageCostPerGbCents,
      );
      const emailCostCents = Math.round(
        (emailCount / 1000) * configuration.emailCostPerThousandCents,
      );
      const allocatedFixedCostCents = organization.status === "ACTIVE" ? fixedShareCents : 0;
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        status: organization.status,
        storageBytes,
        emailCount,
        allocatedFixedCostCents,
        storageCostCents,
        emailCostCents,
        estimatedTotalCents: allocatedFixedCostCents + storageCostCents + emailCostCents,
      };
    });
    const configured =
      configuration.monthlyFixedCostCents > 0 ||
      configuration.emailCostPerThousandCents > 0 ||
      configuration.storageCostPerGbCents > 0;
    return {
      trends,
      costs: {
        configured,
        referenceMonth: monthKey(currentMonth),
        totalEstimatedCents: costs.reduce((sum, item) => sum + item.estimatedTotalCents, 0),
        assumptions: {
          monthlyFixedCostCents: configuration.monthlyFixedCostCents,
          emailCostPerThousandCents: configuration.emailCostPerThousandCents,
          storageCostPerGbCents: configuration.storageCostPerGbCents,
          activeOrganizations,
        },
        organizations: costs,
      },
      sentry,
    };
  }

  async overview() {
    const [
      organizationGroups,
      activeStudents,
      charges,
      received,
      pending,
      failedMessages,
      failedWebhooks,
      storage,
      messageAttempts,
      webhookAttempts,
    ] = await Promise.all([
      this.prisma.client.organization.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.client.student.count({ where: { status: "ACTIVE" } }),
      this.prisma.client.charge.count(),
      this.prisma.client.payment.aggregate({
        where: { status: "CONFIRMED" },
        _sum: { amountCents: true },
      }),
      this.prisma.client.charge.aggregate({
        where: { status: "PENDING" },
        _sum: { finalAmountCents: true },
      }),
      this.prisma.client.messageSchedule.count({
        where: { status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] } },
      }),
      this.prisma.client.webhookEvent.count({
        where: { status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] } },
      }),
      this.prisma.client.storedFile.aggregate({
        where: { status: "ACTIVE" },
        _sum: { sizeBytes: true },
        _count: { _all: true },
      }),
      this.prisma.client.messageDeliveryAttempt.count(),
      this.prisma.client.webhookEventAttempt.count(),
    ]);
    const organizations = Object.fromEntries(
      organizationGroups.map((group) => [group.status, group._count._all]),
    );
    return {
      organizations: {
        total: organizationGroups.reduce(
          (sum, group) => sum + group._count._all,
          0,
        ),
        active: organizations.ACTIVE ?? 0,
        inactive: organizations.INACTIVE ?? 0,
        blocked: organizations.BLOCKED ?? 0,
      },
      activeStudents,
      charges,
      confirmedAmountCents: received._sum.amountCents ?? 0,
      pendingAmountCents: pending._sum.finalAmountCents ?? 0,
      failures: {
        messages: failedMessages,
        webhooks: failedWebhooks,
      },
      internalUsage: {
        storedFiles: storage._count._all,
        storageBytes: storage._sum.sizeBytes ?? 0,
        messageAttempts,
        webhookAttempts,
      },
    };
  }

  async organizations(query: {
    page: number;
    pageSize: number;
    status?: "ACTIVE" | "INACTIVE" | "BLOCKED";
    search?: string;
  }) {
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              {
                owner: {
                  email: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [organizations, total] = await Promise.all([
      this.prisma.client.organization.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          timezone: true,
          createdAt: true,
          owner: { select: { id: true, name: true, email: true } },
          _count: {
            select: {
              students: true,
              charges: true,
              messageSchedules: true,
              webhookEvents: true,
              files: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.organization.count({ where }),
    ]);
    const ids = organizations.map((organization) => organization.id);
    const [storage, attempts, failures] = await Promise.all([
      this.prisma.client.storedFile.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: ids }, status: "ACTIVE" },
        _sum: { sizeBytes: true },
      }),
      this.prisma.client.messageDeliveryAttempt.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.client.messageSchedule.groupBy({
        by: ["organizationId"],
        where: {
          organizationId: { in: ids },
          status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] },
        },
        _count: { _all: true },
      }),
    ]);
    const byOrganization = <T extends { organizationId: string }>(rows: T[]) =>
      new Map(rows.map((row) => [row.organizationId, row]));
    const storageMap = byOrganization(storage);
    const attemptsMap = byOrganization(attempts);
    const failuresMap = byOrganization(failures);
    return {
      items: organizations.map((organization) => ({
        ...organization,
        consumption: {
          storageBytes:
            storageMap.get(organization.id)?._sum.sizeBytes ?? 0,
          messageAttempts:
            attemptsMap.get(organization.id)?._count._all ?? 0,
          messageFailures:
            failuresMap.get(organization.id)?._count._all ?? 0,
        },
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async history(
    organizationId: string,
    query: { page: number; pageSize: number },
  ) {
    await this.organization(organizationId);
    const where = { organizationId };
    const [items, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async failures(query: { organizationId?: string; limit: number }) {
    if (query.organizationId) {
      await this.organization(query.organizationId);
    }
    const organizationWhere = query.organizationId
      ? { organizationId: query.organizationId }
      : {};
    const [messages, webhooks] = await Promise.all([
      this.prisma.client.messageSchedule.findMany({
        where: {
          ...organizationWhere,
          status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] },
        },
        select: {
          id: true,
          organizationId: true,
          status: true,
          attemptCount: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          lastAttemptAt: true,
        },
        orderBy: [{ lastAttemptAt: "desc" }, { id: "desc" }],
        take: query.limit,
      }),
      this.prisma.client.webhookEvent.findMany({
        where: {
          ...organizationWhere,
          status: { in: ["FAILED_RETRYABLE", "FAILED_PERMANENT"] },
        },
        select: {
          id: true,
          organizationId: true,
          provider: true,
          eventType: true,
          status: true,
          attemptCount: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          failedAt: true,
        },
        orderBy: [{ failedAt: "desc" }, { id: "desc" }],
        take: query.limit,
      }),
    ]);
    return { messages, webhooks };
  }

  private async organization(id: string) {
    const organization = await this.prisma.client.organization.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!organization) {
      throw new NotFoundException({
        code: "ORGANIZATION_NOT_FOUND",
        message: "Organization was not found",
      });
    }
    return organization;
  }
}
