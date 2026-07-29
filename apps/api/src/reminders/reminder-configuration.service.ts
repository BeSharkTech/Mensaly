import {
  AuditActorType,
  type ReminderConfiguration,
  type ReminderRule,
  Prisma,
} from "@mensaly/database";
import {
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type { UpdateReminderConfigurationInput } from "./reminder-configuration.dto";

export type ReminderAuditMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type ConfigurationWithRules = ReminderConfiguration & {
  rules: ReminderRule[];
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

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minuteToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function auditMetadata(metadata: ReminderAuditMetadata): ReminderAuditMetadata {
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

function present(configuration: ConfigurationWithRules, timezone: string) {
  return {
    id: configuration.id,
    enabled: configuration.enabled,
    timezone,
    allowedHours: {
      start: minuteToTime(configuration.sendWindowStartMinute),
      end: minuteToTime(configuration.sendWindowEndMinute),
    },
    dailyLimit: configuration.dailyLimit,
    rules: configuration.rules.map((rule) => ({
      id: rule.id,
      timing: rule.timing,
      dayOffset: rule.dayOffset,
      enabled: rule.enabled,
      templateId: rule.templateId,
    })),
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
  };
}

function snapshot(configuration: ConfigurationWithRules, timezone: string) {
  const value = present(configuration, timezone);
  return {
    enabled: value.enabled,
    timezone: value.timezone,
    allowedHours: value.allowedHours,
    dailyLimit: value.dailyLimit,
    rules: value.rules.map(({ timing, dayOffset, templateId, enabled }) => ({
      timing,
      dayOffset,
      templateId,
      enabled,
    })),
  };
}

@Injectable()
export class ReminderConfigurationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async get(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    const organization = await this.prisma.client.organization.findFirst({
      where: { id: orgId },
      select: {
        timezone: true,
        reminderConfiguration: {
          include: {
            rules: {
              orderBy: [{ timing: "asc" }, { dayOffset: "asc" }],
            },
          },
        },
      },
    });
    if (!organization?.reminderConfiguration) {
      throw new NotFoundException({
        code: "REMINDER_CONFIGURATION_NOT_FOUND",
        message: "Reminder configuration was not found",
      });
    }
    return present(
      organization.reminderConfiguration,
      organization.timezone,
    );
  }

  async upsert(
    auth: AuthenticatedContext,
    input: UpdateReminderConfigurationInput,
    metadata: ReminderAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`reminder-configuration:${orgId}`}))`,
      );

      const organization = await tx.organization.findFirst({
        where: { id: orgId },
        select: { timezone: true },
      });
      if (!organization) {
        throw new NotFoundException({
          code: "ORGANIZATION_NOT_FOUND",
          message: "Organization context is required",
        });
      }

      const requestedTemplateIds = [
        ...new Set(
          input.rules
            .filter((rule) => rule.templateId)
            .map((rule) => rule.templateId as string),
        ),
      ];
      const enabledTemplateIds = [
        ...new Set(
          input.rules
            .filter((rule) => rule.enabled && rule.templateId)
            .map((rule) => rule.templateId as string),
        ),
      ];
      const [ownedTemplates, activeTemplates] = await Promise.all([
        tx.messageTemplate.count({
          where: {
            organizationId: orgId,
            id: { in: requestedTemplateIds },
          },
        }),
        tx.messageTemplate.count({
          where: {
            organizationId: orgId,
            id: { in: enabledTemplateIds },
            active: true,
          },
        }),
      ]);
      if (
        ownedTemplates !== requestedTemplateIds.length ||
        activeTemplates !== enabledTemplateIds.length
      ) {
        throw new NotFoundException({
          code: "MESSAGE_TEMPLATE_NOT_FOUND",
          message: "Reminder rules require templates from this organization",
        });
      }

      const current = await tx.reminderConfiguration.findUnique({
        where: { organizationId: orgId },
        include: {
          rules: { orderBy: [{ timing: "asc" }, { dayOffset: "asc" }] },
        },
      });
      const configuration = await tx.reminderConfiguration.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          enabled: input.enabled,
          sendWindowStartMinute: timeToMinute(input.allowedHours.start),
          sendWindowEndMinute: timeToMinute(input.allowedHours.end),
          dailyLimit: input.dailyLimit,
        },
        update: {
          enabled: input.enabled,
          sendWindowStartMinute: timeToMinute(input.allowedHours.start),
          sendWindowEndMinute: timeToMinute(input.allowedHours.end),
          dailyLimit: input.dailyLimit,
        },
      });

      await tx.reminderRule.deleteMany({
        where: { organizationId: orgId, configurationId: configuration.id },
      });
      if (input.rules.length > 0) {
        await tx.reminderRule.createMany({
          data: input.rules.map((rule) => ({
            organizationId: orgId,
            configurationId: configuration.id,
            timing: rule.timing,
            dayOffset: rule.dayOffset,
            templateId: rule.templateId ?? null,
            enabled: rule.enabled,
          })),
        });
      }

      const updated = await tx.reminderConfiguration.findUniqueOrThrow({
        where: { organizationId: orgId },
        include: {
          rules: { orderBy: [{ timing: "asc" }, { dayOffset: "asc" }] },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: current
            ? "reminder_configuration.updated"
            : "reminder_configuration.created",
          entityType: "ReminderConfiguration",
          entityId: configuration.id,
          ...(current
            ? { before: snapshot(current, organization.timezone) }
            : {}),
          after: snapshot(updated, organization.timezone),
          ...auditMetadata(metadata),
        },
      });

      return present(updated, organization.timezone);
    });
  }
}
