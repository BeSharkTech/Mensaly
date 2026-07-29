import * as assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import {
  ChargeStatus,
  createPrismaClient,
  EnrollmentStatus,
  GuardianStatus,
  MessageScheduleStatus,
  OrganizationStatus,
  StudentStatus,
  type PrismaClient,
  UserStatus,
} from "@mensaly/database";
import {
  createMessageQueueRuntime,
  PermanentJobError,
  TransientJobError,
} from "@mensaly/queue";

import { FakeMessageAdapter } from "../src/fake-message.adapter";
import { MessageDispatchProcessor } from "../src/message-dispatch.processor";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Worker integration tests require the mensaly_test database.");
}
if (!redisUrl) {
  throw new Error("Worker integration tests require REDIS_URL.");
}

const prisma = createPrismaClient();
const now = new Date("2026-07-28T15:00:00.000Z");
const organizationIds: string[] = [];
const userIds: string[] = [];

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(
  client: PrismaClient,
  options: { dailyLimit?: number; phone?: string } = {},
) {
  const suffix = randomUUID();
  const user = await client.user.create({
    data: {
      name: "Worker owner",
      email: `worker-${suffix}@example.test`,
      status: UserStatus.ACTIVE,
    },
  });
  userIds.push(user.id);
  const organization = await client.organization.create({
    data: {
      ownerUserId: user.id,
      name: "Worker test",
      timezone: "America/Sao_Paulo",
      status: OrganizationStatus.ACTIVE,
      reminderConfiguration: {
        create: {
          enabled: true,
          sendWindowStartMinute: 0,
          sendWindowEndMinute: 1440,
          dailyLimit: options.dailyLimit ?? 100,
        },
      },
    },
  });
  organizationIds.push(organization.id);
  const plan = await client.plan.create({
    data: {
      organizationId: organization.id,
      name: "Mensal",
      amountCents: 10000,
      dueDay: 10,
    },
  });
  const student = await client.student.create({
    data: { organizationId: organization.id, name: "Aluno" },
  });
  const guardian = await client.guardian.create({
    data: {
      organizationId: organization.id,
      name: "Responsável",
      phone: options.phone ?? "5511999999999",
    },
  });
  const link = await client.studentGuardian.create({
    data: {
      organizationId: organization.id,
      studentId: student.id,
      guardianId: guardian.id,
    },
  });
  const enrollment = await client.enrollment.create({
    data: {
      organizationId: organization.id,
      studentId: student.id,
      guardianId: guardian.id,
      planId: plan.id,
      amountCents: 10000,
      dueDay: 10,
      startDate: new Date("2026-01-01"),
      planNameSnapshot: plan.name,
    },
  });
  const charge = await client.charge.create({
    data: {
      organizationId: organization.id,
      enrollmentId: enrollment.id,
      referenceMonth: new Date("2026-07-01"),
      dueDate: new Date("2026-07-10"),
      amountCents: 10000,
      finalAmountCents: 10000,
    },
  });
  const template = await client.messageTemplate.create({
    data: {
      organizationId: organization.id,
      name: "Cobrança",
      body: "Olá, sua mensalidade está pendente.",
    },
  });
  const schedule = await client.messageSchedule.create({
    data: {
      organizationId: organization.id,
      chargeId: charge.id,
      templateId: template.id,
      status: MessageScheduleStatus.QUEUED,
      scheduledFor: new Date("2026-07-28T14:00:00.000Z"),
      deduplicationKey: createHash("sha256").update(suffix).digest("hex"),
      templateBodySnapshot: template.body,
      recipientNameSnapshot: guardian.name,
      recipientPhoneSnapshot: guardian.phone,
    },
  });
  return { organization, student, guardian, link, charge, template, schedule };
}

async function createSecondSchedule(fixture: Fixture) {
  return prisma.messageSchedule.create({
    data: {
      organizationId: fixture.organization.id,
      chargeId: fixture.charge.id,
      templateId: fixture.template.id,
      status: MessageScheduleStatus.QUEUED,
      scheduledFor: new Date("2026-07-28T14:00:00.000Z"),
      deduplicationKey: createHash("sha256")
        .update(randomUUID())
        .digest("hex"),
      templateBodySnapshot: fixture.template.body,
      recipientNameSnapshot: fixture.guardian.name,
      recipientPhoneSnapshot: fixture.guardian.phone,
    },
  });
}

describe("message dispatch processor integration", () => {
  before(async () => {
    await prisma.$connect();
  });

  it("records SENT, DELIVERED and READ once and ignores duplicate jobs", async () => {
    const fixture = await createFixture(prisma);
    const adapter = new FakeMessageAdapter("READ");
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);
    const job = {
      organizationId: fixture.organization.id,
      scheduleId: fixture.schedule.id,
    };

    await processor.process(job);
    await processor.process(job);

    const schedule = await prisma.messageSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
      include: {
        history: { orderBy: { createdAt: "asc" } },
        deliveryAttempts: true,
      },
    });
    assert.equal(schedule.status, MessageScheduleStatus.READ);
    assert.equal(schedule.attemptCount, 1);
    assert.ok(schedule.sentAt);
    assert.ok(schedule.deliveredAt);
    assert.ok(schedule.readAt);
    assert.match(schedule.providerMessageId ?? "", /^fake_/);
    assert.deepEqual(
      schedule.history.map((item) => item.toStatus),
      ["PROCESSING", "SENT", "DELIVERED", "READ"],
    );
    assert.equal(schedule.deliveryAttempts.length, 1);
    assert.equal(schedule.deliveryAttempts[0]?.status, "SUCCEEDED");
    assert.equal(adapter.calls, 1);
  });

  it("persists a transient failure and succeeds on retry", async () => {
    const fixture = await createFixture(prisma);
    const adapter = new FakeMessageAdapter((_input, call) =>
      call === 1 ? "TRANSIENT_FAILURE" : "DELIVERED",
    );
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);
    const job = {
      organizationId: fixture.organization.id,
      scheduleId: fixture.schedule.id,
    };

    await assert.rejects(processor.process(job), TransientJobError);
    await processor.process(job);

    const schedule = await prisma.messageSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
      include: { deliveryAttempts: { orderBy: { attemptNumber: "asc" } } },
    });
    assert.equal(schedule.status, MessageScheduleStatus.DELIVERED);
    assert.equal(schedule.attemptCount, 2);
    assert.deepEqual(
      schedule.deliveryAttempts.map((item) => item.status),
      ["FAILED_RETRYABLE", "SUCCEEDED"],
    );
    assert.equal(adapter.calls, 2);
  });

  it("does not retry a permanent adapter rejection", async () => {
    const fixture = await createFixture(prisma);
    const adapter = new FakeMessageAdapter("PERMANENT_FAILURE");
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);

    await assert.rejects(
      processor.process({
        organizationId: fixture.organization.id,
        scheduleId: fixture.schedule.id,
      }),
      PermanentJobError,
    );

    const schedule = await prisma.messageSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
      include: { deliveryAttempts: true },
    });
    assert.equal(schedule.status, MessageScheduleStatus.FAILED_PERMANENT);
    assert.equal(schedule.attemptCount, 1);
    assert.equal(schedule.deliveryAttempts.length, 1);
    assert.equal(adapter.calls, 1);
  });

  it("cancels instead of sending when the charge was paid", async () => {
    const fixture = await createFixture(prisma);
    await prisma.charge.update({
      where: { id: fixture.charge.id },
      data: { status: ChargeStatus.PAID, paidAt: now },
    });
    const adapter = new FakeMessageAdapter("READ");
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);

    await processor.process({
      organizationId: fixture.organization.id,
      scheduleId: fixture.schedule.id,
    });

    const schedule = await prisma.messageSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
    });
    assert.equal(schedule.status, MessageScheduleStatus.CANCELLED);
    assert.equal(schedule.cancellationReason, "charge_not_pending");
    assert.equal(schedule.attemptCount, 0);
    assert.equal(adapter.calls, 0);
  });

  it("cancels an automated reminder when its rule was disabled before delivery", async () => {
    const fixture = await createFixture(prisma);
    const configuration =
      await prisma.reminderConfiguration.findUniqueOrThrow({
        where: { organizationId: fixture.organization.id },
      });
    await prisma.reminderRule.create({
      data: {
        organizationId: fixture.organization.id,
        configurationId: configuration.id,
        templateId: fixture.template.id,
        timing: "ON_DUE",
        dayOffset: 0,
        enabled: true,
      },
    });
    await prisma.messageSchedule.update({
      where: { id: fixture.schedule.id },
      data: { automationKey: "ON_DUE:0" },
    });
    await prisma.reminderConfiguration.update({
      where: { id: configuration.id },
      data: { enabled: false },
    });
    const adapter = new FakeMessageAdapter("READ");
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);

    await processor.process({
      organizationId: fixture.organization.id,
      scheduleId: fixture.schedule.id,
    });

    const schedule = await prisma.messageSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
    });
    assert.equal(schedule.status, MessageScheduleStatus.CANCELLED);
    assert.equal(schedule.cancellationReason, "REMINDER_RULE_DISABLED");
    assert.equal(schedule.attemptCount, 0);
    assert.equal(adapter.calls, 0);
  });

  it("revalidates active links, blocks and the daily limit", async () => {
    const unlinked = await createFixture(prisma);
    await prisma.studentGuardian.update({
      where: { id: unlinked.link.id },
      data: { active: false, endedAt: now },
    });
    const unlinkedAdapter = new FakeMessageAdapter("READ");
    await assert.rejects(
      new MessageDispatchProcessor(prisma, unlinkedAdapter, () => now).process({
        organizationId: unlinked.organization.id,
        scheduleId: unlinked.schedule.id,
      }),
      PermanentJobError,
    );
    assert.equal(unlinkedAdapter.calls, 0);

    const blocked = await createFixture(prisma);
    await prisma.messageRecipientBlock.create({
      data: {
        organizationId: blocked.organization.id,
        phone: blocked.guardian.phone,
        reason: "opt_out",
      },
    });
    const blockedAdapter = new FakeMessageAdapter("READ");
    await assert.rejects(
      new MessageDispatchProcessor(prisma, blockedAdapter, () => now).process({
        organizationId: blocked.organization.id,
        scheduleId: blocked.schedule.id,
      }),
      PermanentJobError,
    );
    assert.equal(blockedAdapter.calls, 0);

    const limited = await createFixture(prisma, { dailyLimit: 1 });
    const second = await createSecondSchedule(limited);
    const limitedAdapter = new FakeMessageAdapter("SENT");
    const limitedProcessor = new MessageDispatchProcessor(
      prisma,
      limitedAdapter,
      () => now,
    );
    await limitedProcessor.process({
      organizationId: limited.organization.id,
      scheduleId: limited.schedule.id,
    });
    await assert.rejects(
      limitedProcessor.process({
        organizationId: limited.organization.id,
        scheduleId: second.id,
      }),
      TransientJobError,
    );
    assert.equal(limitedAdapter.calls, 1);
  });

  it("rejects every invalid precondition before calling the adapter", async () => {
    const cases: Array<{
      code: string;
      mutate: (fixture: Fixture) => Promise<unknown>;
    }> = [
      {
        code: "ORGANIZATION_NOT_ACTIVE",
        mutate: (fixture) =>
          prisma.organization.update({
            where: { id: fixture.organization.id },
            data: { status: OrganizationStatus.INACTIVE },
          }),
      },
      {
        code: "ENROLLMENT_NOT_ACTIVE",
        mutate: async (fixture) => {
          const charge = await prisma.charge.findUniqueOrThrow({
            where: { id: fixture.charge.id },
            select: { enrollmentId: true },
          });
          return prisma.enrollment.update({
            where: { id: charge.enrollmentId },
            data: { status: EnrollmentStatus.ENDED },
          });
        },
      },
      {
        code: "STUDENT_NOT_ACTIVE",
        mutate: (fixture) =>
          prisma.student.update({
            where: { id: fixture.student.id },
            data: { status: StudentStatus.INACTIVE },
          }),
      },
      {
        code: "GUARDIAN_NOT_ACTIVE",
        mutate: (fixture) =>
          prisma.guardian.update({
            where: { id: fixture.guardian.id },
            data: { status: GuardianStatus.INACTIVE },
          }),
      },
      {
        code: "INVALID_RECIPIENT_PHONE",
        mutate: (fixture) =>
          prisma.messageSchedule.update({
            where: { id: fixture.schedule.id },
            data: { recipientPhoneSnapshot: "invalid" },
          }),
      },
      {
        code: "RECIPIENT_PHONE_CHANGED",
        mutate: (fixture) =>
          prisma.guardian.update({
            where: { id: fixture.guardian.id },
            data: { phone: "5511888888888" },
          }),
      },
      {
        code: "REMINDERS_DISABLED",
        mutate: (fixture) =>
          prisma.reminderConfiguration.update({
            where: { organizationId: fixture.organization.id },
            data: { enabled: false },
          }),
      },
      {
        code: "MESSAGE_NOT_DUE",
        mutate: (fixture) =>
          prisma.messageSchedule.update({
            where: { id: fixture.schedule.id },
            data: { scheduledFor: new Date("2026-07-29T15:00:00.000Z") },
          }),
      },
      {
        code: "OUTSIDE_SEND_WINDOW",
        mutate: (fixture) =>
          prisma.reminderConfiguration.update({
            where: { organizationId: fixture.organization.id },
            data: {
              sendWindowStartMinute: 780,
              sendWindowEndMinute: 900,
            },
          }),
      },
    ];

    for (const testCase of cases) {
      const fixture = await createFixture(prisma);
      await testCase.mutate(fixture);
      const adapter = new FakeMessageAdapter("READ");
      await assert.rejects(
        new MessageDispatchProcessor(prisma, adapter, () => now).process({
          organizationId: fixture.organization.id,
          scheduleId: fixture.schedule.id,
        }),
        new RegExp(testCase.code),
      );
      assert.equal(adapter.calls, 0, testCase.code);
    }
  });

  it("runs the real processor through BullMQ", async () => {
    const fixture = await createFixture(prisma);
    const adapter = new FakeMessageAdapter("SENT");
    const processor = new MessageDispatchProcessor(prisma, adapter, () => now);
    const prefix = `mensaly-worker-${randomUUID()}`;
    const runtime = await createMessageQueueRuntime({
      redisUrl,
      prefix,
      concurrency: 1,
      attempts: 2,
      backoffMs: 10,
      metricsIntervalMs: 0,
      schedulerIntervalMs: 60_000,
      handler: (job) => processor.process(job.data),
      async schedulerHandler() {},
    });
    try {
      const job = await runtime.enqueue({
        organizationId: fixture.organization.id,
        scheduleId: fixture.schedule.id,
      });
      await runtime.waitForJob(job);
      const schedule = await prisma.messageSchedule.findUniqueOrThrow({
        where: { id: fixture.schedule.id },
      });
      assert.equal(schedule.status, MessageScheduleStatus.SENT);
      assert.equal(adapter.calls, 1);
    } finally {
      await runtime.stop();
    }
  });
});

after(async () => {
  const organizations = { in: organizationIds };
  await prisma.messageDeliveryAttempt.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.messageScheduleHistory.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.messageRecipientBlock.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.messageSchedule.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.reminderRule.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.messageTemplate.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.charge.deleteMany({ where: { organizationId: organizations } });
  await prisma.enrollment.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.studentGuardian.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.guardian.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.student.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.plan.deleteMany({ where: { organizationId: organizations } });
  await prisma.reminderConfiguration.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.organization.deleteMany({ where: { id: organizations } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});
