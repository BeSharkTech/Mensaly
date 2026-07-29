import { createHash } from "node:crypto";

import {
  AuditActorType,
  type MessageSchedule,
  type MessageTemplate,
  Prisma,
} from "@mensaly/database";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type {
  CreateMessageScheduleInput,
  CreateMessageTemplateInput,
  MessageScheduleListQuery,
  MessageTemplateListQuery,
  UpdateMessageTemplateInput,
} from "./messaging.dto";

export type MessagingAuditMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type ScheduleWithTemplate = MessageSchedule & {
  template: Pick<MessageTemplate, "id" | "name">;
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

function auditMetadata(metadata: MessagingAuditMetadata) {
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

function templateView(template: MessageTemplate) {
  return {
    id: template.id,
    name: template.name,
    body: template.body,
    active: template.active,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function scheduleView(schedule: ScheduleWithTemplate) {
  return {
    id: schedule.id,
    chargeId: schedule.chargeId,
    template: schedule.template,
    status: schedule.status,
    scheduledFor: schedule.scheduledFor.toISOString(),
    automation:
      schedule.automationKey
        ? {
            ruleKey: schedule.automationKey,
            queuedAt: schedule.queuedAt?.toISOString() ?? null,
            enqueuedFor: schedule.enqueuedFor?.toISOString() ?? null,
          }
        : null,
    bodySnapshot: schedule.templateBodySnapshot,
    recipient: {
      name: schedule.recipientNameSnapshot,
      phone: schedule.recipientPhoneSnapshot,
    },
    cancellation:
      schedule.cancelledAt && schedule.cancellationReason
        ? {
            at: schedule.cancelledAt.toISOString(),
            reason: schedule.cancellationReason,
          }
        : null,
    delivery: {
      providerMessageId: schedule.providerMessageId,
      sentAt: schedule.sentAt?.toISOString() ?? null,
      deliveredAt: schedule.deliveredAt?.toISOString() ?? null,
      readAt: schedule.readAt?.toISOString() ?? null,
    },
    attempts: {
      count: schedule.attemptCount,
      lastAt: schedule.lastAttemptAt?.toISOString() ?? null,
      lastError:
        schedule.lastErrorCode && schedule.lastErrorMessage
          ? {
              code: schedule.lastErrorCode,
              message: schedule.lastErrorMessage,
            }
          : null,
    },
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

function deduplicationKey(
  organizationIdValue: string,
  input: CreateMessageScheduleInput,
): string {
  return createHash("sha256")
    .update(
      [
        organizationIdValue,
        input.chargeId,
        input.templateId,
        new Date(input.scheduledFor).toISOString(),
      ].join(":"),
    )
    .digest("hex");
}

function duplicateTemplate(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class MessagingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async templates(auth: AuthenticatedContext, query: MessageTemplateListQuery) {
    const orgId = organizationId(auth);
    const where = {
      organizationId: orgId,
      ...(query.active === undefined ? {} : { active: query.active }),
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.messageTemplate.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.messageTemplate.count({ where }),
    ]);
    return {
      items: items.map(templateView),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async template(auth: AuthenticatedContext, id: string) {
    const template = await this.prisma.client.messageTemplate.findFirst({
      where: { id, organizationId: organizationId(auth) },
    });
    if (!template) {
      throw new NotFoundException({
        code: "MESSAGE_TEMPLATE_NOT_FOUND",
        message: "Message template was not found",
      });
    }
    return templateView(template);
  }

  async createTemplate(
    auth: AuthenticatedContext,
    input: CreateMessageTemplateInput,
    metadata: MessagingAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const template = await tx.messageTemplate.create({
          data: { organizationId: orgId, ...input },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "message_template.created",
            entityType: "MessageTemplate",
            entityId: template.id,
            after: {
              name: template.name,
              body: template.body,
              active: template.active,
            },
            ...auditMetadata(metadata),
          },
        });
        return templateView(template);
      });
    } catch (error) {
      if (duplicateTemplate(error)) {
        throw new ConflictException({
          code: "MESSAGE_TEMPLATE_NAME_CONFLICT",
          message: "A template with this name already exists",
        });
      }
      throw error;
    }
  }

  async updateTemplate(
    auth: AuthenticatedContext,
    id: string,
    input: UpdateMessageTemplateInput,
    metadata: MessagingAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const current = await tx.messageTemplate.findFirst({
          where: { id, organizationId: orgId },
        });
        if (!current) {
          throw new NotFoundException({
            code: "MESSAGE_TEMPLATE_NOT_FOUND",
            message: "Message template was not found",
          });
        }
        const updated = await tx.messageTemplate.update({
          where: { id },
          data: input,
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "message_template.updated",
            entityType: "MessageTemplate",
            entityId: id,
            before: {
              name: current.name,
              body: current.body,
              active: current.active,
            },
            after: {
              name: updated.name,
              body: updated.body,
              active: updated.active,
            },
            ...auditMetadata(metadata),
          },
        });
        return templateView(updated);
      });
    } catch (error) {
      if (duplicateTemplate(error)) {
        throw new ConflictException({
          code: "MESSAGE_TEMPLATE_NAME_CONFLICT",
          message: "A template with this name already exists",
        });
      }
      throw error;
    }
  }

  async schedules(auth: AuthenticatedContext, query: MessageScheduleListQuery) {
    const orgId = organizationId(auth);
    const where = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.chargeId ? { chargeId: query.chargeId } : {}),
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.messageSchedule.findMany({
        where,
        include: { template: { select: { id: true, name: true } } },
        orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.messageSchedule.count({ where }),
    ]);
    return {
      items: items.map(scheduleView),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async schedule(auth: AuthenticatedContext, id: string) {
    const schedule = await this.prisma.client.messageSchedule.findFirst({
      where: { id, organizationId: organizationId(auth) },
      include: { template: { select: { id: true, name: true } } },
    });
    if (!schedule) {
      throw new NotFoundException({
        code: "MESSAGE_SCHEDULE_NOT_FOUND",
        message: "Message schedule was not found",
      });
    }
    return scheduleView(schedule);
  }

  async createSchedule(
    auth: AuthenticatedContext,
    input: CreateMessageScheduleInput,
    metadata: MessagingAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const key = deduplicationKey(orgId, input);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`message-schedule:${orgId}:${key}`}))`,
      );
      const existing = await tx.messageSchedule.findUnique({
        where: {
          organizationId_deduplicationKey: {
            organizationId: orgId,
            deduplicationKey: key,
          },
        },
        include: { template: { select: { id: true, name: true } } },
      });
      if (existing) {
        return { schedule: scheduleView(existing), replayed: true };
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${input.chargeId}`}))`,
      );
      const [charge, template] = await Promise.all([
        tx.charge.findFirst({
          where: { id: input.chargeId, organizationId: orgId },
          include: {
            enrollment: {
              include: { guardian: true },
            },
          },
        }),
        tx.messageTemplate.findFirst({
          where: {
            id: input.templateId,
            organizationId: orgId,
            active: true,
          },
        }),
      ]);
      if (!charge) {
        throw new NotFoundException({
          code: "CHARGE_NOT_FOUND",
          message: "Charge was not found",
        });
      }
      if (!template) {
        throw new NotFoundException({
          code: "MESSAGE_TEMPLATE_NOT_FOUND",
          message: "An active message template was not found",
        });
      }
      if (charge.status !== "PENDING") {
        throw new ConflictException({
          code: "CHARGE_STATE_CONFLICT",
          message: "Only pending charges can receive message schedules",
        });
      }

      const created = await tx.messageSchedule.create({
        data: {
          organizationId: orgId,
          chargeId: charge.id,
          templateId: template.id,
          scheduledFor: new Date(input.scheduledFor),
          deduplicationKey: key,
          templateBodySnapshot: template.body,
          recipientNameSnapshot: charge.enrollment.guardian.name,
          recipientPhoneSnapshot: charge.enrollment.guardian.phone,
        },
        include: { template: { select: { id: true, name: true } } },
      });
      await tx.messageScheduleHistory.create({
        data: {
          organizationId: orgId,
          scheduleId: created.id,
          toStatus: "SCHEDULED",
          reason: "SCHEDULE_CREATED",
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "message_schedule.created",
          entityType: "MessageSchedule",
          entityId: created.id,
          after: {
            chargeId: created.chargeId,
            templateId: created.templateId,
            status: created.status,
            scheduledFor: created.scheduledFor.toISOString(),
          },
          ...auditMetadata(metadata),
        },
      });
      return { schedule: scheduleView(created), replayed: false };
    });
  }

  async cancelSchedule(
    auth: AuthenticatedContext,
    id: string,
    metadata: MessagingAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const candidate = await tx.messageSchedule.findFirst({
        where: { id, organizationId: orgId },
        select: { chargeId: true },
      });
      if (!candidate) {
        throw new NotFoundException({
          code: "MESSAGE_SCHEDULE_NOT_FOUND",
          message: "Message schedule was not found",
        });
      }
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${candidate.chargeId}`}))`,
      );
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`message-schedule:${id}`}))`,
      );
      const current = await tx.messageSchedule.findFirst({
        where: { id, organizationId: orgId },
        include: { template: { select: { id: true, name: true } } },
      });
      if (!current) {
        throw new NotFoundException({
          code: "MESSAGE_SCHEDULE_NOT_FOUND",
          message: "Message schedule was not found",
        });
      }
      if (current.status !== "SCHEDULED") {
        throw new ConflictException({
          code: "MESSAGE_SCHEDULE_STATE_CONFLICT",
          message: "Only scheduled messages can be cancelled manually",
        });
      }
      const updated = await tx.messageSchedule.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: "MANUAL_CANCELLATION",
        },
        include: { template: { select: { id: true, name: true } } },
      });
      await tx.messageScheduleHistory.create({
        data: {
          organizationId: orgId,
          scheduleId: id,
          fromStatus: current.status,
          toStatus: "CANCELLED",
          reason: "MANUAL_CANCELLATION",
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "message_schedule.cancelled",
          entityType: "MessageSchedule",
          entityId: id,
          before: { status: current.status },
          after: {
            status: updated.status,
            cancellationReason: updated.cancellationReason,
          },
          ...auditMetadata(metadata),
        },
      });
      return scheduleView(updated);
    });
  }

  async scheduleHistory(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    const schedule = await this.prisma.client.messageSchedule.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!schedule) {
      throw new NotFoundException({
        code: "MESSAGE_SCHEDULE_NOT_FOUND",
        message: "Message schedule was not found",
      });
    }
    const history = await this.prisma.client.messageScheduleHistory.findMany({
      where: { scheduleId: id, organizationId: orgId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return history.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reason: entry.reason,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  async scheduleAttempts(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    const schedule = await this.prisma.client.messageSchedule.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!schedule) {
      throw new NotFoundException({
        code: "MESSAGE_SCHEDULE_NOT_FOUND",
        message: "Message schedule was not found",
      });
    }
    const attempts = await this.prisma.client.messageDeliveryAttempt.findMany({
      where: { scheduleId: id, organizationId: orgId },
      orderBy: [{ attemptNumber: "asc" }, { id: "asc" }],
    });
    return attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      idempotencyKey: attempt.idempotencyKey,
      providerMessageId: attempt.providerMessageId,
      error:
        attempt.errorCode && attempt.errorMessage
          ? { code: attempt.errorCode, message: attempt.errorMessage }
          : null,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    }));
  }
}
