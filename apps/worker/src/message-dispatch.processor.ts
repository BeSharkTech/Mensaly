import {
  ChargeStatus,
  EnrollmentStatus,
  GuardianStatus,
  MessageDeliveryAttemptStatus,
  MessageScheduleStatus,
  OrganizationStatus,
  Prisma,
  type PrismaClient,
  StudentStatus,
} from "@mensaly/database";
import {
  PermanentJobError,
  TransientJobError,
  type MessageDispatchJob,
} from "@mensaly/queue";

import {
  MessageAdapterError,
  type MessageAdapter,
  type MessageDeliveryStatus,
} from "./fake-message.adapter";

type DispatchResult =
  | { kind: "completed" }
  | { kind: "permanent"; message: string }
  | { kind: "transient"; message: string };

type ValidationFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

const TERMINAL_STATUSES = new Set<MessageScheduleStatus>([
  MessageScheduleStatus.SENT,
  MessageScheduleStatus.DELIVERED,
  MessageScheduleStatus.READ,
  MessageScheduleStatus.FAILED_PERMANENT,
  MessageScheduleStatus.CANCELLED,
]);

function localTime(now: Date, timeZone: string): {
  date: Date;
  dateKey: string;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return {
    date: new Date(Date.UTC(year, month - 1, day)),
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MessageDispatchProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adapter: MessageAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: MessageDispatchJob): Promise<void> {
    const result = await this.prisma.$transaction(
      async (tx) => this.processInTransaction(tx, job),
      { timeout: 15_000 },
    );

    if (result.kind === "permanent") {
      throw new PermanentJobError(result.message);
    }
    if (result.kind === "transient") {
      throw new TransientJobError(result.message);
    }
  }

  private async processInTransaction(
    tx: Prisma.TransactionClient,
    job: MessageDispatchJob,
  ): Promise<DispatchResult> {
    const candidate = await tx.messageSchedule.findUnique({
      where: { id: job.scheduleId },
      select: { organizationId: true, chargeId: true },
    });
    if (!candidate || candidate.organizationId !== job.organizationId) {
      return {
        kind: "permanent",
        message: "Message schedule does not belong to the job organization",
      };
    }

    const instant = this.now();
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: job.organizationId },
      select: { timezone: true },
    });
    const local = localTime(instant, organization.timezone);

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`message-daily:${job.organizationId}:${local.dateKey}`}))`,
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${candidate.chargeId}`}))`,
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`message-schedule:${job.scheduleId}`}))`,
    );

    const schedule = await tx.messageSchedule.findUniqueOrThrow({
      where: { id: job.scheduleId },
      include: {
        organization: { include: { reminderConfiguration: true } },
        charge: {
          include: {
            enrollment: {
              include: { student: true, guardian: true },
            },
          },
        },
      },
    });

    if (TERMINAL_STATUSES.has(schedule.status) || schedule.sentAt) {
      return { kind: "completed" };
    }

    if (schedule.charge.status !== ChargeStatus.PENDING) {
      await tx.messageSchedule.update({
        where: { id: schedule.id },
        data: {
          status: MessageScheduleStatus.CANCELLED,
          cancelledAt: instant,
          cancellationReason: "charge_not_pending",
          history: {
            create: {
              fromStatus: schedule.status,
              toStatus: MessageScheduleStatus.CANCELLED,
              reason: "charge_not_pending",
            },
          },
        },
      });
      return { kind: "completed" };
    }

    const configuration = schedule.organization.reminderConfiguration;
    if (schedule.automationKey) {
      const [timing, offsetText] = schedule.automationKey.split(":");
      const activeRule =
        configuration?.enabled &&
        ["BEFORE_DUE", "ON_DUE", "AFTER_DUE"].includes(timing ?? "")
          ? await tx.reminderRule.findFirst({
              where: {
                organizationId: schedule.organizationId,
                timing: timing as "BEFORE_DUE" | "ON_DUE" | "AFTER_DUE",
                dayOffset: Number(offsetText),
                templateId: schedule.templateId,
                enabled: true,
                template: { active: true },
              },
              select: { id: true },
            })
          : null;
      if (!activeRule) {
        await tx.messageSchedule.update({
          where: { id: schedule.id },
          data: {
            status: MessageScheduleStatus.CANCELLED,
            cancelledAt: instant,
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
        return { kind: "completed" };
      }
    }
    let failure: ValidationFailure | undefined;
    if (schedule.organization.status !== OrganizationStatus.ACTIVE) {
      failure = {
        code: "ORGANIZATION_NOT_ACTIVE",
        message: "Organization is not active",
        retryable: false,
      };
    } else if (
      schedule.charge.enrollment.status !== EnrollmentStatus.ACTIVE
    ) {
      failure = {
        code: "ENROLLMENT_NOT_ACTIVE",
        message: "Enrollment is not active",
        retryable: false,
      };
    } else if (
      schedule.charge.enrollment.student.status !== StudentStatus.ACTIVE
    ) {
      failure = {
        code: "STUDENT_NOT_ACTIVE",
        message: "Student is not active",
        retryable: false,
      };
    } else if (
      schedule.charge.enrollment.guardian.status !== GuardianStatus.ACTIVE
    ) {
      failure = {
        code: "GUARDIAN_NOT_ACTIVE",
        message: "Guardian is not active",
        retryable: false,
      };
    } else {
      const activeLink = await tx.studentGuardian.findFirst({
        where: {
          organizationId: schedule.organizationId,
          studentId: schedule.charge.enrollment.studentId,
          guardianId: schedule.charge.enrollment.guardianId,
          active: true,
          endedAt: null,
        },
        select: { id: true },
      });
      if (!activeLink) {
        failure = {
          code: "GUARDIAN_LINK_NOT_ACTIVE",
          message: "Guardian is no longer linked to the student",
          retryable: false,
        };
      }
    }

    if (!failure && !/^[0-9]{8,20}$/.test(schedule.recipientPhoneSnapshot)) {
      failure = {
        code: "INVALID_RECIPIENT_PHONE",
        message: "Recipient phone is invalid",
        retryable: false,
      };
    }
    if (
      !failure &&
      schedule.charge.enrollment.guardian.phone !==
        schedule.recipientPhoneSnapshot
    ) {
      failure = {
        code: "RECIPIENT_PHONE_CHANGED",
        message: "Guardian phone changed after the schedule was created",
        retryable: false,
      };
    }
    if (!failure && (!configuration || !configuration.enabled)) {
      failure = {
        code: "REMINDERS_DISABLED",
        message: "Message reminders are disabled",
        retryable: false,
      };
    }
    if (!failure && schedule.scheduledFor.getTime() > instant.getTime()) {
      failure = {
        code: "MESSAGE_NOT_DUE",
        message: "Message is not due yet",
        retryable: true,
      };
    }
    if (
      !failure &&
      configuration &&
      (local.minute < configuration.sendWindowStartMinute ||
        local.minute >= configuration.sendWindowEndMinute)
    ) {
      failure = {
        code: "OUTSIDE_SEND_WINDOW",
        message: "Current time is outside the allowed send window",
        retryable: true,
      };
    }
    if (!failure) {
      const blocked = await tx.messageRecipientBlock.findFirst({
        where: {
          organizationId: schedule.organizationId,
          phone: schedule.recipientPhoneSnapshot,
          active: true,
        },
        select: { id: true },
      });
      if (blocked) {
        failure = {
          code: "RECIPIENT_BLOCKED",
          message: "Recipient is blocked",
          retryable: false,
        };
      }
    }
    if (!failure && configuration) {
      const sentToday = await tx.messageSchedule.count({
        where: {
          organizationId: schedule.organizationId,
          sentLocalDate: local.date,
          sentAt: { not: null },
        },
      });
      if (sentToday >= configuration.dailyLimit) {
        failure = {
          code: "DAILY_LIMIT_REACHED",
          message: "Organization daily message limit was reached",
          retryable: true,
        };
      }
    }

    const attemptNumber = schedule.attemptCount + 1;
    const idempotencyKey = schedule.deduplicationKey;
    const attempt = await tx.messageDeliveryAttempt.create({
      data: {
        organizationId: schedule.organizationId,
        scheduleId: schedule.id,
        attemptNumber,
        idempotencyKey,
      },
    });
    await tx.messageSchedule.update({
      where: { id: schedule.id },
      data: {
        status: MessageScheduleStatus.PROCESSING,
        attemptCount: attemptNumber,
        lastAttemptAt: instant,
        lastErrorCode: null,
        lastErrorMessage: null,
        history: {
          create: {
            fromStatus: schedule.status,
            toStatus: MessageScheduleStatus.PROCESSING,
            reason: "dispatch_attempt_started",
            metadata: { attemptNumber },
          },
        },
      },
    });

    if (failure) {
      return this.recordFailure(tx, schedule.id, attempt.id, failure, instant);
    }

    try {
      const response = await this.adapter.send({
        idempotencyKey,
        recipientPhone: schedule.recipientPhoneSnapshot,
        recipientName: schedule.recipientNameSnapshot,
        body: schedule.templateBodySnapshot,
      });
      await this.recordSuccess(
        tx,
        schedule.id,
        schedule.organizationId,
        attempt.id,
        response.providerMessageId,
        response.statuses,
        instant,
        local.date,
      );
      return { kind: "completed" };
    } catch (error) {
      const adapterError =
        error instanceof MessageAdapterError ? error : undefined;
      return this.recordFailure(
        tx,
        schedule.id,
        attempt.id,
        {
          code: adapterError?.code ?? "ADAPTER_UNEXPECTED_ERROR",
          message: errorText(error),
          retryable: adapterError?.retryable ?? true,
        },
        instant,
      );
    }
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    scheduleId: string,
    attemptId: string,
    failure: ValidationFailure,
    instant: Date,
  ): Promise<DispatchResult> {
    const errorCode = failure.code.slice(0, 120);
    const errorMessage = failure.message.slice(0, 1_000);
    const status = failure.retryable
      ? MessageScheduleStatus.FAILED_RETRYABLE
      : MessageScheduleStatus.FAILED_PERMANENT;
    const attemptStatus = failure.retryable
      ? MessageDeliveryAttemptStatus.FAILED_RETRYABLE
      : MessageDeliveryAttemptStatus.FAILED_PERMANENT;
    const schedule = await tx.messageSchedule.update({
      where: { id: scheduleId },
      data: {
        status,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      },
      select: { organizationId: true },
    });
    await Promise.all([
      tx.messageDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: attemptStatus,
          errorCode,
          errorMessage,
          finishedAt: instant,
        },
      }),
      tx.messageScheduleHistory.create({
        data: {
          organizationId: schedule.organizationId,
          scheduleId,
          fromStatus: MessageScheduleStatus.PROCESSING,
          toStatus: status,
          reason: errorCode.toLowerCase(),
          metadata: { retryable: failure.retryable },
        },
      }),
    ]);
    return {
      kind: failure.retryable ? "transient" : "permanent",
      message: `${failure.code}: ${failure.message}`,
    };
  }

  private async recordSuccess(
    tx: Prisma.TransactionClient,
    scheduleId: string,
    organizationId: string,
    attemptId: string,
    providerMessageId: string,
    statuses: MessageDeliveryStatus[],
    instant: Date,
    localDate: Date,
  ): Promise<void> {
    let fromStatus: MessageScheduleStatus =
      MessageScheduleStatus.PROCESSING;
    for (const status of statuses) {
      const toStatus = MessageScheduleStatus[status];
      await tx.messageScheduleHistory.create({
        data: {
          organizationId,
          scheduleId,
          fromStatus,
          toStatus,
          reason: `fake_adapter_${status.toLowerCase()}`,
          metadata: { providerMessageId },
        },
      });
      fromStatus = toStatus;
    }
    const finalStatus = statuses.at(-1);
    if (!finalStatus) {
      throw new MessageAdapterError(
        "Adapter returned no delivery status",
        "ADAPTER_EMPTY_STATUS",
        true,
      );
    }
    await Promise.all([
      tx.messageSchedule.update({
        where: { id: scheduleId },
        data: {
          status: MessageScheduleStatus[finalStatus],
          providerMessageId,
          sentAt: statuses.includes("SENT") ? instant : undefined,
          sentLocalDate: statuses.includes("SENT") ? localDate : undefined,
          deliveredAt: statuses.includes("DELIVERED") ? instant : undefined,
          readAt: statuses.includes("READ") ? instant : undefined,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      }),
      tx.messageDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: MessageDeliveryAttemptStatus.SUCCEEDED,
          providerMessageId,
          finishedAt: instant,
        },
      }),
    ]);
  }
}
