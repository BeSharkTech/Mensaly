import { createHash } from "node:crypto";

import {
  AuditActorType,
  EnrollmentStatus,
  MessageScheduleStatus,
  OrganizationStatus,
  Prisma,
  type PrismaClient,
  type ReminderTiming,
} from "@mensaly/database";
import type { MessageQueueRuntime, QueueLogger } from "@mensaly/queue";

type SchedulerQueue = Pick<MessageQueueRuntime, "enqueue" | "remove">;

export type ScheduledTaskSummary = {
  chargesCreated: number;
  schedulesCreated: number;
  schedulesCancelled: number;
  messagesEnqueued: number;
};

const silentLogger: QueueLogger = {
  info() {},
  warn() {},
  error() {},
};

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function dueDate(referenceMonth: Date, dueDay: number): Date {
  const year = referenceMonth.getUTCFullYear();
  const month = referenceMonth.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dueDay, lastDay)));
}

function zonedDateTime(
  date: Date,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
    );
    const adjustment = desired - represented;
    candidate += adjustment;
    if (adjustment === 0) {
      break;
    }
  }
  return new Date(candidate);
}

function ruleKey(timing: ReminderTiming, dayOffset: number): string {
  return `${timing}:${dayOffset}`;
}

function ruleDate(
  due: Date,
  timing: ReminderTiming,
  dayOffset: number,
): Date {
  if (timing === "BEFORE_DUE") {
    return addCalendarDays(due, -dayOffset);
  }
  if (timing === "AFTER_DUE") {
    return addCalendarDays(due, dayOffset);
  }
  return due;
}

function scheduleKey(
  organizationId: string,
  chargeId: string,
  automationKey: string,
): string {
  return createHash("sha256")
    .update(`${organizationId}:${chargeId}:${automationKey}`)
    .digest("hex");
}

export class ScheduledTasksService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: SchedulerQueue,
    private readonly options: {
      now?: () => Date;
      lookaheadMs: number;
      logger?: QueueLogger;
    },
  ) {}

  async reconcile(): Promise<ScheduledTaskSummary> {
    const now = this.options.now?.() ?? new Date();
    const logger = this.options.logger ?? silentLogger;
    const summary = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('scheduled-task-reconcile'))`,
        );
        const result: ScheduledTaskSummary = {
          chargesCreated: 0,
          schedulesCreated: 0,
          schedulesCancelled: 0,
          messagesEnqueued: 0,
        };
        const organizations = await tx.organization.findMany({
          where: { status: OrganizationStatus.ACTIVE },
          include: {
            reminderConfiguration: {
              include: {
                rules: {
                  include: { template: true },
                  orderBy: [{ timing: "asc" }, { dayOffset: "asc" }],
                },
              },
            },
          },
          orderBy: { id: "asc" },
        });

        for (const organization of organizations) {
          const current = localDate(now, organization.timezone);
          const referenceMonth = calendarDate(
            current.year,
            current.month,
            1,
          );
          const monthEnd = new Date(
            Date.UTC(current.year, current.month, 0),
          );
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge-generation:${organization.id}:${current.year}-${String(current.month).padStart(2, "0")}`}))`,
          );
          const enrollments = await tx.enrollment.findMany({
            where: {
              organizationId: organization.id,
              status: EnrollmentStatus.ACTIVE,
              startDate: { lte: monthEnd },
              OR: [{ endDate: null }, { endDate: { gte: referenceMonth } }],
            },
            select: {
              id: true,
              amountCents: true,
              discountCents: true,
              dueDay: true,
            },
          });
          const createdCharges =
            enrollments.length > 0
              ? await tx.charge.createMany({
                  data: enrollments.map((enrollment) => ({
                    organizationId: organization.id,
                    enrollmentId: enrollment.id,
                    referenceMonth,
                    dueDate: dueDate(referenceMonth, enrollment.dueDay),
                    amountCents: enrollment.amountCents,
                    discountCents: enrollment.discountCents,
                    finalAmountCents:
                      enrollment.amountCents - enrollment.discountCents,
                  })),
                  skipDuplicates: true,
                })
              : { count: 0 };
          result.chargesCreated += createdCharges.count;
          if (createdCharges.count > 0) {
            await tx.auditLog.create({
              data: {
                organizationId: organization.id,
                actorType: AuditActorType.SYSTEM,
                action: "charge.generated_by_scheduler",
                entityType: "ChargeGeneration",
                after: {
                  referenceMonth: `${current.year}-${String(current.month).padStart(2, "0")}`,
                  created: createdCharges.count,
                },
              },
            });
          }

          const configuration = organization.reminderConfiguration;
          const activeRules =
            configuration?.enabled
              ? configuration.rules.filter(
                  (rule) =>
                    rule.enabled &&
                    rule.templateId &&
                    rule.template?.active,
                )
              : [];
          const activeRuleKeys = new Set(
            activeRules.map((rule) => ruleKey(rule.timing, rule.dayOffset)),
          );
          const obsolete = await tx.messageSchedule.findMany({
            where: {
              organizationId: organization.id,
              automationKey: { not: null },
              status: {
                in: [
                  MessageScheduleStatus.SCHEDULED,
                  MessageScheduleStatus.QUEUED,
                ],
              },
            },
          });
          for (const schedule of obsolete) {
            if (
              schedule.automationKey &&
              activeRuleKeys.has(schedule.automationKey)
            ) {
              continue;
            }
            if (schedule.status === MessageScheduleStatus.QUEUED) {
              await this.queue.remove(schedule.id);
            }
            await tx.messageSchedule.update({
              where: { id: schedule.id },
              data: {
                status: MessageScheduleStatus.CANCELLED,
                cancelledAt: now,
                cancellationReason: "REMINDER_RULE_DISABLED",
                history: {
                  create: {
                    fromStatus: schedule.status,
                    toStatus: MessageScheduleStatus.CANCELLED,
                    reason: "REMINDER_RULE_DISABLED",
                  },
                },
              },
            });
            result.schedulesCancelled += 1;
          }

          if (!configuration?.enabled || activeRules.length === 0) {
            continue;
          }
          const charges = await tx.charge.findMany({
            where: {
              organizationId: organization.id,
              status: "PENDING",
              dueDate: {
                gte: addCalendarDays(
                  calendarDate(current.year, current.month, current.day),
                  -60,
                ),
                lte: addCalendarDays(
                  calendarDate(current.year, current.month, current.day),
                  60,
                ),
              },
            },
            select: { id: true },
          });
          for (const candidate of charges) {
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${candidate.id}`}))`,
            );
            const charge = await tx.charge.findUnique({
              where: { id: candidate.id },
              include: {
                enrollment: {
                  include: { guardian: true },
                },
              },
            });
            if (!charge || charge.status !== "PENDING") {
              continue;
            }
            for (const rule of activeRules) {
              if (!rule.templateId || !rule.template) {
                continue;
              }
              const automationKey = ruleKey(rule.timing, rule.dayOffset);
              const scheduledFor = zonedDateTime(
                ruleDate(charge.dueDate, rule.timing, rule.dayOffset),
                configuration.sendWindowStartMinute,
                organization.timezone,
              );
              const key = scheduleKey(
                organization.id,
                charge.id,
                automationKey,
              );
              const existing = await tx.messageSchedule.findUnique({
                where: {
                  organizationId_chargeId_automationKey: {
                    organizationId: organization.id,
                    chargeId: charge.id,
                    automationKey,
                  },
                },
              });
              if (!existing) {
                await tx.messageSchedule.create({
                  data: {
                    organizationId: organization.id,
                    chargeId: charge.id,
                    templateId: rule.templateId,
                    scheduledFor,
                    deduplicationKey: key,
                    automationKey,
                    templateBodySnapshot: rule.template.body,
                    recipientNameSnapshot: charge.enrollment.guardian.name,
                    recipientPhoneSnapshot: charge.enrollment.guardian.phone,
                    history: {
                      create: {
                        toStatus: MessageScheduleStatus.SCHEDULED,
                        reason: "SCHEDULER_CREATED",
                        metadata: { automationKey },
                      },
                    },
                  },
                });
                result.schedulesCreated += 1;
                continue;
              }
              if (
                existing.status !== MessageScheduleStatus.SCHEDULED &&
                existing.status !== MessageScheduleStatus.QUEUED
              ) {
                continue;
              }
              const changed =
                existing.scheduledFor.getTime() !== scheduledFor.getTime() ||
                existing.templateId !== rule.templateId ||
                existing.templateBodySnapshot !== rule.template.body ||
                existing.recipientNameSnapshot !==
                  charge.enrollment.guardian.name ||
                existing.recipientPhoneSnapshot !==
                  charge.enrollment.guardian.phone;
              if (!changed) {
                continue;
              }
              if (existing.status === MessageScheduleStatus.QUEUED) {
                await this.queue.remove(existing.id);
              }
              await tx.messageSchedule.update({
                where: { id: existing.id },
                data: {
                  status: MessageScheduleStatus.SCHEDULED,
                  scheduledFor,
                  templateId: rule.templateId,
                  templateBodySnapshot: rule.template.body,
                  recipientNameSnapshot: charge.enrollment.guardian.name,
                  recipientPhoneSnapshot: charge.enrollment.guardian.phone,
                  queuedAt: null,
                  enqueuedFor: null,
                  history: {
                    create: {
                      fromStatus: existing.status,
                      toStatus: MessageScheduleStatus.SCHEDULED,
                      reason: "SCHEDULER_RESCHEDULED",
                    },
                  },
                },
              });
            }
          }
        }

        return result;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
    await this.enqueueReady(now, summary);
    logger.info(
      { component: "scheduled-tasks", ...summary },
      "Scheduled tasks reconciled",
    );
    return summary;
  }

  private async enqueueReady(
    now: Date,
    summary: ScheduledTaskSummary,
  ): Promise<void> {
    const horizon = new Date(now.getTime() + this.options.lookaheadMs);
    const ready = await this.prisma.messageSchedule.findMany({
      where: {
        status: {
          in: [
            MessageScheduleStatus.SCHEDULED,
            MessageScheduleStatus.QUEUED,
          ],
        },
        scheduledFor: { lte: horizon },
        charge: { status: "PENDING" },
        organization: { status: OrganizationStatus.ACTIVE },
      },
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
    });
    for (const schedule of ready) {
      const needsReplacement =
        schedule.status === MessageScheduleStatus.QUEUED &&
        schedule.enqueuedFor?.getTime() !== schedule.scheduledFor.getTime();
      if (needsReplacement) {
        await this.queue.remove(schedule.id);
      }
      await this.queue.enqueue(
        {
          organizationId: schedule.organizationId,
          scheduleId: schedule.id,
        },
        {
          delayMs: Math.max(
            0,
            schedule.scheduledFor.getTime() - now.getTime(),
          ),
        },
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`message-schedule:${schedule.id}`}))`,
        );
        const current = await tx.messageSchedule.findUnique({
          where: { id: schedule.id },
        });
        if (
          !current ||
          (current.status !== MessageScheduleStatus.SCHEDULED &&
            current.status !== MessageScheduleStatus.QUEUED)
        ) {
          return;
        }
        await tx.messageSchedule.update({
          where: { id: current.id },
          data: {
            status: MessageScheduleStatus.QUEUED,
            queuedAt: now,
            enqueuedFor: current.scheduledFor,
            ...(current.status === MessageScheduleStatus.SCHEDULED
              ? {
                  history: {
                    create: {
                      fromStatus: MessageScheduleStatus.SCHEDULED,
                      toStatus: MessageScheduleStatus.QUEUED,
                      reason: "SCHEDULER_ENQUEUED",
                      metadata: {
                        delayed: current.scheduledFor.getTime() > now.getTime(),
                      },
                    },
                  },
                }
              : {}),
          },
        });
      });
      summary.messagesEnqueued += 1;
    }
  }
}
