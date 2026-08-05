import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
} from "@mensaly/config";
import { getPrismaClient } from "@mensaly/database";

import { createApiApplication } from "../app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const emails = new Set<string>();
const organizationIds = new Set<string>();

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("Insights tests require isolated test services.");
}

function environment() {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: "https://allowed.example",
    ADMIN_MONTHLY_FIXED_COST_CENTS: "2400",
    ADMIN_EMAIL_COST_PER_THOUSAND_CENTS: "100",
    ADMIN_STORAGE_COST_PER_GB_CENTS: "150",
  });
}

function cookieHeader(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(";")[0];
}

function taxId(prefix: string) {
  return `${prefix}${randomUUID()
    .replace(/\D/g, "")
    .padEnd(10, "0")
    .slice(0, 10)}`;
}

describe("dashboard and platform insights", () => {
  it("aggregates company data without tenant leakage and restricts administration", async () => {
    const app = await createApiApplication(environment());
    const password = "correct-horse-battery-staple";
    const suffix = randomUUID();
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createCompany = async (label: string, prefix: string) => {
        const email = `insights-${label}-${suffix}@api.example.test`;
        emails.add(email);
        await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { name: `Insights ${label}`, email, password },
        });
        const user = await getPrismaClient().user.update({
          where: { email },
          data: { emailVerified: true, status: "ACTIVE" },
        });
        const login = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        const cookie = cookieHeader(login.headers["set-cookie"]);
        assert.ok(cookie);
        const organization = await fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/organization",
          payload: {
            name: `Insights ${label} ${suffix}`,
            taxId: taxId(prefix),
            phone: "11999999999",
          },
        });
        assert.equal(organization.statusCode, 201);
        organizationIds.add(organization.json().data.id);
        return {
          cookie,
          userId: user.id,
          organizationId: organization.json().data.id as string,
        };
      };
      const accountA = await createCompany("A", "6");
      const accountB = await createCompany("B", "7");
      const prisma = getPrismaClient();

      const plan = await prisma.plan.create({
        data: {
          organizationId: accountA.organizationId,
          name: "Dashboard plan",
          amountCents: 10000,
          dueDay: 10,
        },
      });
      const guardian = await prisma.guardian.create({
        data: {
          organizationId: accountA.organizationId,
          name: "Dashboard guardian",
          phone: "5511999999999",
        },
      });
      const createCharge = async (input: {
        name: string;
        amount: number;
        dueDate: string;
        status: "PENDING" | "PAID" | "CANCELLED";
        referenceMonth?: string;
      }) => {
        const student = await prisma.student.create({
          data: {
            organizationId: accountA.organizationId,
            name: input.name,
          },
        });
        await prisma.studentGuardian.create({
          data: {
            organizationId: accountA.organizationId,
            studentId: student.id,
            guardianId: guardian.id,
          },
        });
        const enrollment = await prisma.enrollment.create({
          data: {
            organizationId: accountA.organizationId,
            studentId: student.id,
            guardianId: guardian.id,
            planId: plan.id,
            amountCents: input.amount,
            dueDay: 10,
            startDate: new Date("2026-01-01"),
            planNameSnapshot: plan.name,
          },
        });
        return prisma.charge.create({
          data: {
            organizationId: accountA.organizationId,
            enrollmentId: enrollment.id,
            cycleKey: `test:insights:${randomUUID()}`,
            referenceMonth: new Date(
              `${input.referenceMonth ?? "2026-07"}-01T00:00:00.000Z`,
            ),
            dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
            amountCents: input.amount,
            finalAmountCents: input.amount,
            status: input.status,
            ...(input.status === "PAID"
              ? { paidAt: new Date(`${input.dueDate}T12:00:00.000Z`) }
              : {}),
            ...(input.status === "CANCELLED"
              ? { cancelledAt: new Date("2026-07-01T12:00:00.000Z") }
              : {}),
          },
        });
      };
      const paid = await createCharge({
        name: "Paid student",
        amount: 10000,
        dueDate: "2026-07-10",
        status: "PAID",
      });
      const overdue = await createCharge({
        name: "Overdue student",
        amount: 20000,
        dueDate: "2026-07-05",
        status: "PENDING",
      });
      await createCharge({
        name: "Upcoming student",
        amount: 30000,
        dueDate: "2026-07-20",
        status: "PENDING",
      });
      await createCharge({
        name: "Cancelled student",
        amount: 40000,
        dueDate: "2026-07-12",
        status: "CANCELLED",
      });
      await createCharge({
        name: "June student",
        amount: 5000,
        dueDate: "2026-06-10",
        referenceMonth: "2026-06",
        status: "PAID",
      });
      await prisma.payment.create({
        data: {
          organizationId: accountA.organizationId,
          chargeId: paid.id,
          idempotencyKey: `dashboard-${suffix}`,
          amountCents: 10000,
          method: "PIX",
          status: "CONFIRMED",
          paidAt: new Date("2026-07-10T12:00:00.000Z"),
        },
      });
      const template = await prisma.messageTemplate.create({
        data: {
          organizationId: accountA.organizationId,
          name: `Failure ${suffix}`,
          body: "Failure",
        },
      });
      await prisma.messageSchedule.create({
        data: {
          organizationId: accountA.organizationId,
          chargeId: overdue.id,
          templateId: template.id,
          status: "FAILED_PERMANENT",
          scheduledFor: new Date("2026-07-05T12:00:00.000Z"),
          deduplicationKey: randomUUID().replace(/-/g, "").padEnd(64, "0"),
          templateBodySnapshot: "Failure",
          recipientNameSnapshot: guardian.name,
          recipientPhoneSnapshot: guardian.phone,
          attemptCount: 1,
          lastAttemptAt: new Date("2026-07-05T12:00:00.000Z"),
          lastErrorCode: "TEST_FAILURE",
          lastErrorMessage: "Expected failure",
        },
      });

      const otherPlan = await prisma.plan.create({
        data: {
          organizationId: accountB.organizationId,
          name: "Other plan",
          amountCents: 999999,
          dueDay: 10,
        },
      });
      const otherStudent = await prisma.student.create({
        data: { organizationId: accountB.organizationId, name: "Other" },
      });
      const otherGuardian = await prisma.guardian.create({
        data: {
          organizationId: accountB.organizationId,
          name: "Other guardian",
          phone: "5511888888888",
        },
      });
      const otherEnrollment = await prisma.enrollment.create({
        data: {
          organizationId: accountB.organizationId,
          studentId: otherStudent.id,
          guardianId: otherGuardian.id,
          planId: otherPlan.id,
          amountCents: 999999,
          dueDay: 10,
          startDate: new Date("2026-01-01"),
          planNameSnapshot: otherPlan.name,
        },
      });
      await prisma.charge.create({
        data: {
          organizationId: accountB.organizationId,
          enrollmentId: otherEnrollment.id,
          cycleKey: "test:insights:other-organization",
          referenceMonth: new Date("2026-07-01T00:00:00.000Z"),
          dueDate: new Date("2026-07-01T00:00:00.000Z"),
          amountCents: 999999,
          finalAmountCents: 999999,
        },
      });

      const overview = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/overview?asOf=2026-07-15",
      });
      assert.equal(overview.statusCode, 200);
      assert.deepEqual(overview.json().data, {
        asOf: "2026-07-15",
        referenceMonth: "2026-07",
        activeStudents: 5,
        expectedAmountCents: 60000,
        receivedAmountCents: 10000,
        pendingAmountCents: 50000,
        paidCharges: 1,
        overdueCharges: 1,
        delinquencyRate: 33.33,
      });
      const invalidDate = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/overview?asOf=2026-02-31",
      });
      assert.equal(invalidDate.statusCode, 400);
      assert.equal(invalidDate.json().error.code, "VALIDATION_ERROR");
      const upcoming = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/upcoming-due?asOf=2026-07-15&days=10",
      });
      assert.equal(upcoming.json().data.length, 1);
      assert.equal(
        upcoming.json().data[0].enrollment.student.name,
        "Upcoming student",
      );
      const recent = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/recent-payments",
      });
      assert.equal(recent.json().data.length, 1);
      const failures = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/message-failures",
      });
      assert.equal(failures.json().data.length, 1);
      const evolution = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/dashboard/monthly-evolution?asOf=2026-07-15&months=2",
      });
      assert.equal(evolution.statusCode, 200);
      assert.deepEqual(
        evolution.json().data.map(
          (month: { month: string; expectedAmountCents: number }) => [
            month.month,
            month.expectedAmountCents,
          ],
        ),
        [
          ["2026-06", 5000],
          ["2026-07", 60000],
        ],
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "GET",
            url: "/api/v1/admin/overview",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "GET",
            url: "/api/v1/admin/analytics",
          })
        ).statusCode,
        403,
      );

      const adminEmail = `insights-admin-${suffix}@api.example.test`;
      emails.add(adminEmail);
      await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { name: "Insights Admin", email: adminEmail, password },
      });
      await prisma.user.update({
        where: { email: adminEmail },
        data: {
          emailVerified: true,
          status: "ACTIVE",
          role: "PLATFORM_ADMIN",
        },
      });
      const adminLogin = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: adminEmail, password },
      });
      const adminCookie = cookieHeader(adminLogin.headers["set-cookie"]);
      assert.ok(adminCookie);
      const adminOverview = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: "/api/v1/admin/overview",
      });
      assert.equal(adminOverview.statusCode, 200);
      assert.equal(adminOverview.json().data.organizations.total >= 2, true);
      assert.equal(
        typeof adminOverview.json().data.internalUsage.storageBytes,
        "number",
      );
      const analytics = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: "/api/v1/admin/analytics?days=30&months=6",
      });
      assert.equal(analytics.statusCode, 200);
      assert.equal(analytics.json().data.trends.length, 6);
      assert.equal(analytics.json().data.costs.configured, true);
      assert.equal(
        analytics.json().data.costs.organizations.some(
          (organization: { organizationId: string }) =>
            organization.organizationId === accountA.organizationId,
        ),
        true,
      );
      assert.equal(analytics.json().data.sentry.status, "not_configured");
      const invalidAnalytics = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: "/api/v1/admin/analytics?days=2&months=99",
      });
      assert.equal(invalidAnalytics.statusCode, 400);
      assert.equal(invalidAnalytics.json().error.code, "VALIDATION_ERROR");
      const organizations = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: `/api/v1/admin/organizations?search=${suffix}`,
      });
      assert.equal(organizations.statusCode, 200);
      assert.equal(organizations.json().meta.total, 2);
      const organizationA = organizations
        .json()
        .data.find(
          (organization: { id: string }) =>
            organization.id === accountA.organizationId,
        );
      assert.equal(organizationA._count.students, 5);
      assert.equal(organizationA.consumption.messageFailures, 1);
      const history = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: `/api/v1/admin/organizations/${accountA.organizationId}/history`,
      });
      assert.equal(history.statusCode, 200);
      assert.equal(history.json().meta.total >= 1, true);
      const adminFailures = await fastify.inject({
        headers: { cookie: adminCookie },
        method: "GET",
        url: `/api/v1/admin/failures?organizationId=${accountA.organizationId}`,
      });
      assert.equal(adminFailures.json().data.messages.length, 1);
      assert.equal(adminFailures.json().data.webhooks.length, 0);

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.ok(openApi.json().paths["/api/v1/dashboard/overview"]);
      assert.ok(openApi.json().paths["/api/v1/admin/overview"]);
      assert.ok(openApi.json().paths["/api/v1/admin/analytics"]);
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  const organizations = [...organizationIds];
  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { organizationId: { in: organizations } },
        { actorUserId: { in: userIds } },
      ],
    },
  });
  await prisma.messageDeliveryAttempt.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.messageScheduleHistory.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.messageSchedule.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.messageTemplate.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.payment.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.charge.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.enrollment.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.studentGuardian.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.plan.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.student.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.guardian.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verification.deleteMany({
    where: { identifier: { in: [...emails] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizations } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});
