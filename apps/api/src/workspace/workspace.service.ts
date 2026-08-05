import { AuditActorType, Prisma } from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type {
  BroadcastInput,
  CustomFieldInput,
  EventInput,
  ProductInput,
} from "./workspace.dto";

function organizationId(auth: AuthenticatedContext) {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function notFound(): never {
  throw new NotFoundException({
    code: "RESOURCE_NOT_FOUND",
    message: "Resource was not found",
  });
}

function valuesMap(rows: { studentId?: string; guardianId?: string; fieldId: string; value: string }[], key: "studentId" | "guardianId") {
  const result: Record<string, Record<string, string>> = {};
  rows.forEach((row) => {
    const id = row[key];
    if (id) result[id] = { ...(result[id] ?? {}), [row.fieldId]: row.value };
  });
  return result;
}

@Injectable()
export class WorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private audit(
    tx: Prisma.TransactionClient,
    auth: AuthenticatedContext,
    action: string,
    entityType: string,
    entityId: string,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: organizationId(auth),
        actorUserId: auth.userId,
        actorType: AuditActorType.USER,
        action,
        entityType,
        entityId,
      },
    });
  }

  async all(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    const [fields, fieldValues, guardianFieldValues, products, events, broadcasts, broadcastSends] =
      await Promise.all([
        this.prisma.client.customField.findMany({
          where: { organizationId: orgId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
        this.prisma.client.studentFieldValue.findMany({
          where: { organizationId: orgId },
        }),
        this.prisma.client.guardianFieldValue.findMany({ where: { organizationId: orgId } }),
        this.prisma.client.product.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.client.event.findMany({
          where: { organizationId: orgId },
          orderBy: { startsAt: "asc" },
        }),
        this.prisma.client.broadcastMessage.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.client.broadcastSend.findMany({
          where: { organizationId: orgId },
          orderBy: { sentAt: "desc" },
        }),
      ]);
    return {
      customFields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.fieldType,
        subject: field.subject,
        options: Array.isArray(field.options) ? field.options : [],
        required: field.required,
        sortOrder: field.sortOrder,
        active: field.active,
      })),
      studentFieldValues: valuesMap(fieldValues, "studentId"),
      guardianFieldValues: valuesMap(guardianFieldValues, "guardianId"),
      products,
      events,
      broadcasts,
      broadcastSends,
    };
  }

  async createProduct(auth: AuthenticatedContext, input: ProductInput) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.product.create({ data: { ...input, organizationId: orgId } });
      await this.audit(tx, auth, "product.created", "Product", item.id);
      return item;
    });
  }

  async updateProduct(auth: AuthenticatedContext, id: string, input: Partial<ProductInput>) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.product.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      const item = await tx.product.update({ where: { id }, data: input });
      await this.audit(tx, auth, "product.updated", "Product", id);
      return item;
    });
  }

  async deleteProduct(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.product.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      await tx.product.delete({ where: { id } });
      await this.audit(tx, auth, "product.deleted", "Product", id);
    });
  }

  async createEvent(auth: AuthenticatedContext, input: EventInput) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.event.create({
        data: {
          ...input,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          organizationId: orgId,
        },
      });
      await this.audit(tx, auth, "event.created", "Event", item.id);
      return item;
    });
  }

  async updateEvent(auth: AuthenticatedContext, id: string, input: Partial<EventInput>) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.event.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      const item = await tx.event.update({
        where: { id },
        data: {
          ...input,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt:
            input.endsAt === undefined
              ? undefined
              : input.endsAt
                ? new Date(input.endsAt)
                : null,
        },
      });
      if (item.endsAt && item.endsAt < item.startsAt) {
        throw new BadRequestException({
          code: "EVENT_DATE_RANGE_INVALID",
          message: "End date cannot precede start date",
        });
      }
      await this.audit(tx, auth, "event.updated", "Event", id);
      return item;
    });
  }

  async deleteEvent(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.event.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      await tx.event.delete({ where: { id } });
      await this.audit(tx, auth, "event.deleted", "Event", id);
    });
  }

  async createField(auth: AuthenticatedContext, input: CustomFieldInput) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.customField.create({
        data: { ...input, organizationId: orgId },
      });
      await this.audit(tx, auth, "custom_field.created", "CustomField", item.id);
      return item;
    });
  }

  async updateField(auth: AuthenticatedContext, id: string, input: Partial<CustomFieldInput>) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.customField.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      const nextType = input.fieldType ?? current.fieldType;
      const nextOptions = input.options ?? (Array.isArray(current.options) ? current.options : []);
      if (nextType === "SELECT" && nextOptions.length === 0) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_OPTIONS_REQUIRED",
          message: "Select fields require at least one option",
        });
      }
      const item = await tx.customField.update({ where: { id }, data: input });
      await this.audit(tx, auth, "custom_field.updated", "CustomField", id);
      return item;
    });
  }

  async deleteField(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.customField.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      await tx.studentFieldValue.deleteMany({ where: { organizationId: orgId, fieldId: id } });
      await tx.guardianFieldValue.deleteMany({ where: { organizationId: orgId, fieldId: id } });
      await tx.customField.delete({ where: { id } });
      await this.audit(tx, auth, "custom_field.deleted", "CustomField", id);
    });
  }

  async replaceStudentValues(
    auth: AuthenticatedContext,
    studentId: string,
    values: Record<string, string>,
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: studentId } },
      });
      if (!student) return notFound();
      const fieldIds = Object.keys(values);
      const fields = fieldIds.length
        ? await tx.customField.findMany({
            where: {
              organizationId: orgId,
              id: { in: fieldIds },
              active: true,
            },
          })
        : [];
      if (fields.length !== fieldIds.length) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_INVALID",
          message: "One or more custom fields are invalid",
        });
      }
      if (fields.some((field) => field.subject !== "STUDENT")) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_SUBJECT_INVALID",
          message: "One or more custom fields do not belong to students",
        });
      }
      await tx.studentFieldValue.deleteMany({ where: { organizationId: orgId, studentId } });
      if (fieldIds.length) {
        await tx.studentFieldValue.createMany({
          data: fieldIds.map((fieldId) => ({
            organizationId: orgId,
            studentId,
            fieldId,
            value: values[fieldId]!,
          })),
        });
      }
      await this.audit(tx, auth, "student_fields.replaced", "Student", studentId);
      return { saved: fieldIds.length };
    });
  }

  async replaceGuardianValues(
    auth: AuthenticatedContext,
    guardianId: string,
    values: Record<string, string>,
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: guardianId } },
      });
      if (!guardian) return notFound();
      const fieldIds = Object.keys(values);
      const fields = fieldIds.length
        ? await tx.customField.findMany({
            where: {
              organizationId: orgId,
              id: { in: fieldIds },
              active: true,
            },
          })
        : [];
      if (fields.length !== fieldIds.length) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_INVALID",
          message: "One or more guardian custom fields are invalid",
        });
      }
      if (fields.some((field) => field.subject !== "GUARDIAN")) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_SUBJECT_INVALID",
          message: "One or more custom fields do not belong to guardians",
        });
      }
      await tx.guardianFieldValue.deleteMany({ where: { organizationId: orgId, guardianId } });
      if (fieldIds.length) {
        await tx.guardianFieldValue.createMany({
          data: fieldIds.map((fieldId) => ({
            organizationId: orgId,
            guardianId,
            fieldId,
            value: values[fieldId]!,
          })),
        });
      }
      await this.audit(tx, auth, "guardian_fields.replaced", "Guardian", guardianId);
      return { saved: fieldIds.length };
    });
  }

  async createBroadcast(auth: AuthenticatedContext, input: BroadcastInput) {
    const orgId = organizationId(auth);
    await this.validateBroadcastTarget(orgId, input);
    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.broadcastMessage.create({
        data: {
          ...input,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          repeatUntil: input.repeatUntil
            ? new Date(`${input.repeatUntil}T00:00:00.000Z`)
            : null,
          organizationId: orgId,
        },
      });
      await this.audit(tx, auth, "broadcast.created", "BroadcastMessage", item.id);
      return item;
    });
  }

  async updateBroadcast(auth: AuthenticatedContext, id: string, input: Partial<BroadcastInput>) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.broadcastMessage.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      await this.validateBroadcastTarget(orgId, {
        targetType:
          input.targetType ??
          (current.targetType as BroadcastInput["targetType"]),
        planId: input.planId === undefined ? current.planId : input.planId,
        productId: input.productId === undefined ? current.productId : input.productId,
        eventId: input.eventId === undefined ? current.eventId : input.eventId,
      });
      const item = await tx.broadcastMessage.update({
        where: { id },
        data: {
          ...input,
          scheduledFor:
            input.scheduledFor === undefined
              ? undefined
              : input.scheduledFor
                ? new Date(input.scheduledFor)
                : null,
          repeatUntil:
            input.repeatUntil === undefined
              ? undefined
              : input.repeatUntil
                ? new Date(`${input.repeatUntil}T00:00:00.000Z`)
                : null,
        },
      });
      await this.audit(tx, auth, "broadcast.updated", "BroadcastMessage", id);
      return item;
    });
  }

  private async validateBroadcastTarget(orgId: string, input: Partial<BroadcastInput>) {
    const targetId =
      input.targetType === "PLAN"
        ? input.planId
        : input.targetType === "PRODUCT"
          ? input.productId
          : input.targetType === "EVENT"
            ? input.eventId
            : true;
    if (!targetId) {
      throw new BadRequestException({
        code: "BROADCAST_TARGET_REQUIRED",
        message: "The selected broadcast target is required",
      });
    }
    const checks = await Promise.all([
      input.planId
        ? this.prisma.client.plan.findUnique({
            where: { organizationId_id: { organizationId: orgId, id: input.planId } },
          })
        : true,
      input.productId
        ? this.prisma.client.product.findUnique({
            where: { organizationId_id: { organizationId: orgId, id: input.productId } },
          })
        : true,
      input.eventId
        ? this.prisma.client.event.findUnique({
            where: { organizationId_id: { organizationId: orgId, id: input.eventId } },
          })
        : true,
    ]);
    if (checks.some((check) => !check)) return notFound();
  }

  async deleteBroadcast(auth: AuthenticatedContext, id: string) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.broadcastMessage.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) return notFound();
      await tx.broadcastSend.deleteMany({ where: { organizationId: orgId, messageId: id } });
      await tx.broadcastMessage.delete({ where: { id } });
      await this.audit(tx, auth, "broadcast.deleted", "BroadcastMessage", id);
    });
  }

  async queueBroadcast(
    auth: AuthenticatedContext,
    input: { messageId: string; studentIds: string[]; scheduledFor?: string | null },
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const message = await tx.broadcastMessage.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: input.messageId } },
      });
      if (!message) return notFound();
      const students = await tx.student.findMany({
        where: {
          organizationId: orgId,
          id: { in: input.studentIds },
          status: "ACTIVE",
        },
        include: {
          enrollments: {
            where: { status: "ACTIVE" },
            take: 1,
            include: { guardian: true },
          },
        },
      });
      if (students.length !== new Set(input.studentIds).size) return notFound();
      const missingPhone = students.find((student) => !student.enrollments[0]?.guardian.phone);
      if (missingPhone) {
        throw new ConflictException({
          code: "BROADCAST_RECIPIENT_MISSING",
          message: `Student ${missingPhone.name} has no active financial guardian`,
        });
      }
      const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
      await tx.broadcastSend.createMany({
        data: students.map((student) => ({
          organizationId: orgId,
          messageId: message.id,
          studentId: student.id,
          studentName: student.name,
          recipient: student.enrollments[0]!.guardian.phone,
          status: scheduledFor ? "SCHEDULED" : "QUEUED",
          scheduledFor,
        })),
      });
      await this.audit(tx, auth, "broadcast.queued", "BroadcastMessage", message.id);
      return { queued: students.length, scheduledFor };
    });
  }

  async publicForm(organizationId: string) {
    const organization = await this.prisma.client.organization.findFirst({
      where: { id: organizationId, status: "ACTIVE" },
    });
    if (!organization) return notFound();
    const fields = await this.prisma.client.customField.findMany({
      where: { organizationId, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const brand = (organization.brand ?? {}) as Record<string, unknown>;
    const address = (organization.address ?? {}) as Record<string, unknown>;
    return {
      business: {
        name: organization.name,
        logoDataUrl: typeof brand.logoDataUrl === "string" ? brand.logoDataUrl : null,
        brandColor: typeof brand.primaryColor === "string" ? brand.primaryColor : null,
        city: typeof address.city === "string" ? address.city : "",
        segment: typeof brand.segment === "string" ? brand.segment : "",
      },
      fields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.fieldType,
        options: Array.isArray(field.options) ? field.options : [],
        required: field.required,
      })),
    };
  }

  async submitPublicForm(
    organizationId: string,
    input: { cpf: string; values: Record<string, string> },
  ) {
    const cpf = input.cpf.replace(/\D/g, "");
    if (cpf.length !== 11) {
      throw new BadRequestException({
        code: "CPF_INVALID",
        message: "CPF must contain 11 digits",
      });
    }
    const students = await this.prisma.client.student.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        cpf,
      },
      take: 2,
    });
    if (students.length !== 1) {
      throw new NotFoundException({
        code: "STUDENT_NOT_FOUND",
        message: "Aluno não encontrado. Confira o CPF informado.",
      });
    }
    const fields = await this.prisma.client.customField.findMany({
      where: { organizationId, active: true },
    });
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    if (Object.keys(input.values).some((fieldId) => !fieldById.has(fieldId))) {
      throw new BadRequestException({
        code: "CUSTOM_FIELD_INVALID",
        message: "One or more custom fields are invalid",
      });
    }
    const missing = fields.find((field) => field.required && !input.values[field.id]?.trim());
    if (missing) {
      throw new BadRequestException({
        code: "CUSTOM_FIELD_REQUIRED",
        message: `O campo ${missing.label} é obrigatório.`,
      });
    }
    const saved = await this.prisma.client.$transaction(async (tx) => {
      await tx.studentFieldValue.deleteMany({
        where: { organizationId, studentId: students[0]!.id },
      });
      const rows = Object.entries(input.values).filter(([, value]) => value.trim());
      if (rows.length) {
        await tx.studentFieldValue.createMany({
          data: rows.map(([fieldId, value]) => ({
            organizationId,
            studentId: students[0]!.id,
            fieldId,
            value,
          })),
        });
      }
      return rows.length;
    });
    return { studentName: students[0]!.name, saved };
  }
}
