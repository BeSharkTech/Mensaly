import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import {
  createPrismaClient,
  MessageScheduleStatus,
  OrganizationStatus,
  Prisma,
  UserStatus,
} from "@mensaly/database";
import type {
  MessageDispatchJob,
  MessageQueueRuntime,
} from "@mensaly/queue";

import { ScheduledTasksService } from "../src/scheduled-tasks.service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Scheduled task tests require the mensaly_test database.");
}

const prisma = createPrismaClient();
const organizationIds: string[] = [];
const userIds: string[] = [];

type Enqueued = {
  payload: MessageDispatchJob;
  delayMs: number;
};

function queueRecorder(
  beforeEnqueue?: (payload: MessageDispatchJob) => Promise<void>,
) {
  const enqueued: Enqueued[] = [];
  const removed: string[] = [];
  return {
    enqueued,
    removed,
    queue: {
      async enqueue(
        payload: MessageDispatchJob,
        options?: { delayMs?: number },
      ) {
        await beforeEnqueue?.(payload);
        enqueued.push({ payload, delayMs: options?.delayMs ?? 0 });
        return {} as Awaited<
          ReturnType<MessageQueueRuntime["enqueue"]>
        >;
      },
      async remove(scheduleId: string) {
        removed.push(scheduleId);
        return true;
      },
    },
  };
}

async function createFixture() {
  if (organizationIds.length > 0) {
    await prisma.organization.updateMany({
      where: { id: { in: organizationIds } },
      data: { status: OrganizationStatus.INACTIVE },
    });
  }
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      name: "Scheduler owner",
      email: `scheduler-${suffix}@example.test`,
      status: UserStatus.ACTIVE,
    },
  });
  userIds.push(user.id);
  const organization = await prisma.organization.create({
    data: {
      ownerUserId: user.id,
      name: "Scheduler school",
      timezone: "America/Sao_Paulo",
      status: OrganizationStatus.ACTIVE,
    },
  });
  organizationIds.push(organization.id);
  const template = await prisma.messageTemplate.create({
    data: {
      organizationId: organization.id,
      name: "Lembrete automático",
      body: "Sua mensalidade vence em breve.",
    },
  });
  const configuration = await prisma.reminderConfiguration.create({
    data: {
      organizationId: organization.id,
      enabled: true,
      sendWindowStartMinute: 480,
      sendWindowEndMinute: 1080,
      dailyLimit: 100,
    },
  });
  const rule = await prisma.reminderRule.create({
    data: {
      organizationId: organization.id,
      configurationId: configuration.id,
      templateId: template.id,
      timing: "BEFORE_DUE",
      dayOffset: 3,
      enabled: true,
    },
  });
  const plan = await prisma.plan.create({
    data: {
      organizationId: organization.id,
      name: "Mensal",
      amountCents: 12000,
      dueDay: 10,
    },
  });
  const student = await prisma.student.create({
    data: { organizationId: organization.id, name: "Aluno Scheduler" },
  });
  const guardian = await prisma.guardian.create({
    data: {
      organizationId: organization.id,
      name: "Responsável Scheduler",
      phone: "5511999999999",
    },
  });
  await prisma.studentGuardian.create({
    data: {
      organizationId: organization.id,
      studentId: student.id,
      guardianId: guardian.id,
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: {
      organizationId: organization.id,
      studentId: student.id,
      guardianId: guardian.id,
      planId: plan.id,
      amountCents: 12000,
      discountCents: 1000,
      dueDay: 10,
      startDate: new Date("2026-01-01"),
      planNameSnapshot: plan.name,
    },
  });
  return {
    organization,
    template,
    configuration,
    rule,
    enrollment,
  };
}

describe("scheduled tasks integration", () => {
  before(async () => {
    await prisma.$connect();
  });

  it("generates the monthly charge and a delayed reminder with a controlled clock", async () => {
    const fixture = await createFixture();
    const recorder = queueRecorder(async (payload) => {
      const committedSchedule = await prisma.messageSchedule.findUnique({
        where: { id: payload.scheduleId },
      });
      assert.equal(
        committedSchedule?.status,
        MessageScheduleStatus.SCHEDULED,
        "the schedule must be committed before its queue job becomes visible",
      );
    });
    const now = new Date("2026-07-01T12:00:00.000Z");
    const service = new ScheduledTasksService(prisma, recorder.queue, {
      now: () => now,
      lookaheadMs: 15 * 24 * 60 * 60 * 1000,
    });

    const result = await service.reconcile();

    assert.equal(result.chargesCreated, 1);
    assert.equal(result.schedulesCreated, 1);
    assert.equal(result.messagesEnqueued, 1);
    const charge = await prisma.charge.findFirstOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    assert.equal(charge.referenceMonth.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(charge.dueDate.toISOString(), "2026-07-10T00:00:00.000Z");
    assert.equal(charge.finalAmountCents, 11000);
    const schedule = await prisma.messageSchedule.findFirstOrThrow({
      where: { organizationId: fixture.organization.id },
      include: { history: { orderBy: { createdAt: "asc" } } },
    });
    assert.equal(schedule.status, MessageScheduleStatus.QUEUED);
    assert.equal(schedule.automationKey, "BEFORE_DUE:3");
    assert.equal(schedule.scheduledFor.toISOString(), "2026-07-07T11:00:00.000Z");
    assert.equal(schedule.enqueuedFor?.getTime(), schedule.scheduledFor.getTime());
    assert.deepEqual(
      schedule.history.map((entry) => entry.toStatus),
      ["SCHEDULED", "QUEUED"],
    );
    assert.equal(
      recorder.enqueued[0]?.delayMs,
      schedule.scheduledFor.getTime() - now.getTime(),
    );
  });

  it("serializes concurrent reconciliation without duplicating domain data", async () => {
    const fixture = await createFixture();
    const recorder = queueRecorder();
    const now = new Date("2026-07-01T12:00:00.000Z");
    const service = new ScheduledTasksService(prisma, recorder.queue, {
      now: () => now,
      lookaheadMs: 15 * 24 * 60 * 60 * 1000,
    });

    await Promise.all([service.reconcile(), service.reconcile()]);

    assert.equal(
      await prisma.charge.count({
        where: { organizationId: fixture.organization.id },
      }),
      1,
    );
    assert.equal(
      await prisma.messageSchedule.count({
        where: { organizationId: fixture.organization.id },
      }),
      1,
    );
    assert.equal(
      await prisma.messageScheduleHistory.count({
        where: { organizationId: fixture.organization.id },
      }),
      2,
    );
  });

  it("recovers queued work after restart and executes overdue work immediately", async () => {
    const fixture = await createFixture();
    const firstQueue = queueRecorder();
    const firstClock = new Date("2026-07-01T12:00:00.000Z");
    await new ScheduledTasksService(prisma, firstQueue.queue, {
      now: () => firstClock,
      lookaheadMs: 15 * 24 * 60 * 60 * 1000,
    }).reconcile();

    const restartedQueue = queueRecorder();
    const lateClock = new Date("2026-07-08T12:00:00.000Z");
    const result = await new ScheduledTasksService(
      prisma,
      restartedQueue.queue,
      {
        now: () => lateClock,
        lookaheadMs: 15 * 24 * 60 * 60 * 1000,
      },
    ).reconcile();

    assert.equal(result.chargesCreated, 0);
    assert.equal(result.schedulesCreated, 0);
    assert.equal(result.messagesEnqueued, 1);
    assert.equal(restartedQueue.enqueued[0]?.delayMs, 0);
    assert.equal(
      await prisma.messageSchedule.count({
        where: { organizationId: fixture.organization.id },
      }),
      1,
    );
  });

  it("waits for a concurrent payment and does not create a stale reminder", async () => {
    const fixture = await createFixture();
    const referenceMonth = new Date("2026-07-01T00:00:00.000Z");
    const charge = await prisma.charge.create({
      data: {
        organizationId: fixture.organization.id,
        enrollmentId: fixture.enrollment.id,
        referenceMonth,
        dueDate: new Date("2026-07-10T00:00:00.000Z"),
        amountCents: 12000,
        discountCents: 1000,
        finalAmountCents: 11000,
      },
    });
    let signalLocked: (() => void) | undefined;
    let releasePayment: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });
    const payment = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${charge.id}`}))`,
        );
        signalLocked?.();
        await released;
        await tx.charge.update({
          where: { id: charge.id },
          data: { status: "PAID", paidAt: new Date("2026-07-01T12:00:00.000Z") },
        });
      },
      { timeout: 10_000 },
    );
    await locked;
    const recorder = queueRecorder();
    const reconciliation = new ScheduledTasksService(
      prisma,
      recorder.queue,
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        lookaheadMs: 15 * 24 * 60 * 60 * 1000,
      },
    ).reconcile();
    await new Promise((resolve) => setTimeout(resolve, 100));
    releasePayment?.();
    await Promise.all([payment, reconciliation]);

    assert.equal(
      await prisma.messageSchedule.count({
        where: { organizationId: fixture.organization.id },
      }),
      0,
    );
    assert.equal(recorder.enqueued.length, 0);
  });

  it("creates the next month once and cancels queued reminders when rules are disabled", async () => {
    const fixture = await createFixture();
    const recorder = queueRecorder();
    const service = new ScheduledTasksService(prisma, recorder.queue, {
      now: () => new Date("2026-07-01T12:00:00.000Z"),
      lookaheadMs: 15 * 24 * 60 * 60 * 1000,
    });
    await service.reconcile();
    const julySchedule = await prisma.messageSchedule.findFirstOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    await prisma.reminderConfiguration.update({
      where: { id: fixture.configuration.id },
      data: { enabled: false },
    });

    const disabled = await service.reconcile();
    assert.equal(disabled.schedulesCancelled, 1);
    assert.deepEqual(recorder.removed, [julySchedule.id]);
    assert.equal(
      (
        await prisma.messageSchedule.findUniqueOrThrow({
          where: { id: julySchedule.id },
        })
      ).status,
      MessageScheduleStatus.CANCELLED,
    );

    await prisma.reminderConfiguration.update({
      where: { id: fixture.configuration.id },
      data: { enabled: true },
    });
    const august = await new ScheduledTasksService(prisma, recorder.queue, {
      now: () => new Date("2026-08-01T12:00:00.000Z"),
      lookaheadMs: 15 * 24 * 60 * 60 * 1000,
    }).reconcile();
    assert.equal(august.chargesCreated, 1);
    assert.equal(
      await prisma.charge.count({
        where: { organizationId: fixture.organization.id },
      }),
      2,
    );
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
  await prisma.auditLog.deleteMany({
    where: { organizationId: organizations },
  });
  await prisma.organization.deleteMany({ where: { id: organizations } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});
