import { AuditActorType, Prisma } from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { normalizeRg } from "../common/brazilian-documents";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type {
  CreateEnrollmentInput,
  CreateGuardianInput,
  CreatePlanInput,
  CreateStudentInput,
  CreateStudentEnrollmentInput,
  EnrollmentListInput,
  OperationalListInput,
  UpdateEnrollmentInput,
  UpdateGuardianInput,
  UpdatePlanInput,
  UpdateStudentInput,
} from "./operational.dto";

export type OperationalAuditMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
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

function missing(): never {
  throw new NotFoundException({
    code: "RESOURCE_NOT_FOUND",
    message: "Resource was not found",
  });
}

function normalizedPhone(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\D/g, "");
  if (normalized.length < 10 || normalized.length > 15) {
    throw new BadRequestException({
      code: "PHONE_INVALID",
      message: "Phone must contain between 10 and 15 digits",
    });
  }
  return normalized;
}

function normalizedCpf(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\D/g, "");
  if (normalized.length !== 11) {
    throw new BadRequestException({
      code: "CPF_INVALID",
      message: "CPF must contain 11 digits",
    });
  }
  return normalized;
}

function metadata(value: OperationalAuditMetadata): OperationalAuditMetadata {
  return {
    ...(value.correlationId ? { correlationId: value.correlationId } : {}),
    ...(value.ipAddress ? { ipAddress: value.ipAddress.slice(0, 64) } : {}),
    ...(value.userAgent
      ? { userAgent: value.userAgent.slice(0, 1_024) }
      : {}),
  };
}

function validateEnrollmentValues(
  amountCents: number,
  discountCents: number,
  startDate: Date,
  endDate?: Date | null,
): void {
  if (discountCents >= amountCents) {
    throw new BadRequestException({
      code: "ENROLLMENT_DISCOUNT_INVALID",
      message: "Discount must be lower than the enrollment amount",
    });
  }
  if (endDate && endDate < startDate) {
    throw new BadRequestException({
      code: "ENROLLMENT_DATE_RANGE_INVALID",
      message: "End date cannot precede start date",
    });
  }
}

function validateChargeWindow(chargeOpenDay: number, dueDay: number): void {
  if (chargeOpenDay > dueDay) {
    throw new BadRequestException({
      code: "CHARGE_WINDOW_INVALID",
      message: "Charge opening day cannot be after due day",
    });
  }
}

@Injectable()
export class OperationalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private audit(
    transaction: Prisma.TransactionClient,
    auth: AuthenticatedContext,
    action: string,
    entityType: string,
    entityId: string,
    orgId: string,
    auditMetadata: OperationalAuditMetadata,
  ) {
    return transaction.auditLog.create({
      data: {
        organizationId: orgId,
        actorUserId: auth.userId,
        actorType: AuditActorType.USER,
        action,
        entityType,
        entityId,
        ...metadata(auditMetadata),
      },
    });
  }

  async plans(auth: AuthenticatedContext, query: OperationalListInput) {
    const orgId = organizationId(auth);
    const where: Prisma.PlanWhereInput = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.plan.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.plan.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async plan(auth: AuthenticatedContext, id: string) {
    const item = await this.prisma.client.plan.findUnique({
      where: {
        organizationId_id: { organizationId: organizationId(auth), id },
      },
    });
    return item ?? missing();
  }

  async createPlan(
    auth: AuthenticatedContext,
    input: CreatePlanInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    validateChargeWindow(input.chargeOpenDay, input.dueDay);
    return this.prisma.client.$transaction(async (transaction) => {
      const item = await transaction.plan.create({
        data: { ...input, organizationId: orgId },
      });
      await this.audit(
        transaction,
        auth,
        "plan.created",
        "Plan",
        item.id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }

  async updatePlan(
    auth: AuthenticatedContext,
    id: string,
    input: UpdatePlanInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (transaction) => {
      const current = await transaction.plan.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) {
        return missing();
      }
      const chargeOpenDay = input.chargeOpenDay ?? current.chargeOpenDay;
      const chargeOpenTime = input.chargeOpenTime ?? current.chargeOpenTime;
      const dueDay = input.dueDay ?? current.dueDay;
      validateChargeWindow(chargeOpenDay, dueDay);
      const item = await transaction.plan.update({
        where: { organizationId_id: { organizationId: orgId, id } },
        data: input,
      });
      if (current.status === "ACTIVE" && input.status === "INACTIVE") {
        const activeEnrollments = await transaction.enrollment.findMany({
          where: { organizationId: orgId, planId: id, status: "ACTIVE" },
          select: { id: true, startDate: true },
        });
        const now = new Date();
        for (const enrollment of activeEnrollments) {
          await transaction.enrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "CANCELLED",
              endDate: enrollment.startDate > now ? enrollment.startDate : now,
            },
          });
        }
      }
      if (
        chargeOpenDay !== current.chargeOpenDay ||
        chargeOpenTime !== current.chargeOpenTime ||
        dueDay !== current.dueDay
      ) {
        await transaction.enrollment.updateMany({
          where: { organizationId: orgId, planId: id, status: "ACTIVE" },
          data: { chargeOpenDay, chargeOpenTime, dueDay },
        });
      }
      await this.audit(
        transaction,
        auth,
        "plan.updated",
        "Plan",
        id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }

  async students(auth: AuthenticatedContext, query: OperationalListInput) {
    const orgId = organizationId(auth);
    const where: Prisma.StudentWhereInput = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { cpf: { contains: query.search } },
              { email: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.student.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: { photoFile: { select: { id: true, contentType: true } } },
      }),
      this.prisma.client.student.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async student(auth: AuthenticatedContext, id: string) {
    const item = await this.prisma.client.student.findUnique({
      where: {
        organizationId_id: { organizationId: organizationId(auth), id },
      },
      include: {
        guardianLinks: { where: { active: true }, include: { guardian: true } },
        enrollments: true,
        photoFile: { select: { id: true, contentType: true } },
      },
    });
    return item ?? missing();
  }

  async createStudent(
    auth: AuthenticatedContext,
    input: CreateStudentInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const studentPhone = normalizedPhone(input.phone);
    const studentCpf = normalizedCpf(input.cpf);
    const studentRg = input.rg ? normalizeRg(input.rg) : undefined;
    if (input.rg && !studentRg) {
      throw new BadRequestException({ code: "RG_INVALID", message: "RG is invalid" });
    }
    if (!studentCpf && !studentRg) {
      throw new BadRequestException({ code: "STUDENT_DOCUMENT_REQUIRED", message: "CPF or RG is required" });
    }
    const birthDate = input.birthDate
      ? new Date(`${input.birthDate}T00:00:00.000Z`)
      : undefined;
    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        if (input.photoFileId) {
          const file = await transaction.storedFile.findFirst({
            where: {
              id: input.photoFileId,
              organizationId: orgId,
              status: "ACTIVE",
              contentType: { in: ["image/jpeg", "image/png"] },
            },
          });
          if (!file) {
            throw new BadRequestException({
              code: "STUDENT_PHOTO_INVALID",
              message: "Student photo is invalid",
            });
          }
        }
        const item = await transaction.student.create({
          data: { ...input, cpf: studentCpf, rg: studentRg, birthDate, organizationId: orgId, phone: studentPhone },
        });
        await this.audit(
          transaction,
          auth,
          "student.created",
          "Student",
          item.id,
          orgId,
          auditMetadata,
        );
        return item;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "STUDENT_CPF_CONFLICT",
          message: "A student with this CPF already exists",
        });
      }
      throw error;
    }
  }

  async updateStudent(
    auth: AuthenticatedContext,
    id: string,
    input: UpdateStudentInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const studentPhone =
      input.phone === undefined ? undefined : normalizedPhone(input.phone);
    const studentCpf =
      input.cpf === undefined
        ? undefined
        : input.cpf === null
          ? null
          : normalizedCpf(input.cpf);
    const studentRg =
      input.rg === undefined
        ? undefined
        : input.rg === null
          ? null
          : normalizeRg(input.rg);
    if (input.rg !== undefined && input.rg !== null && !studentRg) {
      throw new BadRequestException({ code: "RG_INVALID", message: "RG is invalid" });
    }
    const birthDate =
      input.birthDate === undefined
        ? undefined
        : new Date(`${input.birthDate}T00:00:00.000Z`);
    return this.prisma.client.$transaction(async (transaction) => {
      const exists = await transaction.student.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
        select: { id: true, status: true, cpf: true, rg: true },
      });
      if (!exists) {
        return missing();
      }
      const nextCpf = studentCpf === undefined ? exists.cpf : studentCpf;
      const nextRg = studentRg === undefined ? exists.rg : studentRg;
      if (!nextCpf && !nextRg) {
        throw new BadRequestException({
          code: "STUDENT_DOCUMENT_REQUIRED",
          message: "CPF or RG is required",
        });
      }
      if (input.photoFileId) {
        const file = await transaction.storedFile.findFirst({
          where: {
            id: input.photoFileId,
            organizationId: orgId,
            status: "ACTIVE",
            contentType: { in: ["image/jpeg", "image/png"] },
          },
        });
        if (!file) {
          throw new BadRequestException({
            code: "STUDENT_PHOTO_INVALID",
            message: "Student photo is invalid",
          });
        }
      }
      const item = await transaction.student.update({
        where: { organizationId_id: { organizationId: orgId, id } },
        data: { ...input, cpf: studentCpf, rg: studentRg, birthDate, phone: studentPhone },
      });
      if (exists.status === "ACTIVE" && input.status === "INACTIVE") {
        const activeEnrollments = await transaction.enrollment.findMany({
          where: { organizationId: orgId, studentId: id, status: "ACTIVE" },
          select: { id: true, startDate: true },
        });
        const now = new Date();
        for (const enrollment of activeEnrollments) {
          await transaction.enrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "CANCELLED",
              endDate: enrollment.startDate > now ? enrollment.startDate : now,
            },
          });
        }
      }
      await this.audit(
        transaction,
        auth,
        "student.updated",
        "Student",
        id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }

  async removeStudent(
    auth: AuthenticatedContext,
    id: string,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (transaction) => {
      const student = await transaction.student.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
        select: { id: true },
      });
      if (!student) {
        return missing();
      }

      const [chargeCount, publicSubmissionCount] = await Promise.all([
        transaction.charge.count({
          where: { organizationId: orgId, enrollment: { studentId: id } },
        }),
        transaction.publicEnrollmentSubmission.count({
          where: { organizationId: orgId, studentId: id },
        }),
      ]);
      if (chargeCount > 0 || publicSubmissionCount > 0) {
        throw new ConflictException({
          code: "STUDENT_REMOVAL_BLOCKED",
          message:
            "Students with payment or public enrollment history cannot be removed. Deactivate the student instead.",
        });
      }

      await transaction.billingRuleTarget.deleteMany({
        where: { organizationId: orgId, studentId: id },
      });
      await transaction.studentFieldValue.deleteMany({
        where: { organizationId: orgId, studentId: id },
      });
      await transaction.studentGuardian.deleteMany({
        where: { organizationId: orgId, studentId: id },
      });
      await transaction.enrollment.deleteMany({
        where: { organizationId: orgId, studentId: id },
      });
      await transaction.student.delete({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      await this.audit(
        transaction,
        auth,
        "student.deleted",
        "Student",
        id,
        orgId,
        auditMetadata,
      );
      return { id };
    });
  }

  async guardians(auth: AuthenticatedContext, query: OperationalListInput) {
    const orgId = organizationId(auth);
    const where: Prisma.GuardianWhereInput = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
              { taxId: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.guardian.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.guardian.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async guardian(auth: AuthenticatedContext, id: string) {
    const item = await this.prisma.client.guardian.findUnique({
      where: {
        organizationId_id: { organizationId: organizationId(auth), id },
      },
      include: { studentLinks: { include: { student: true } } },
    });
    return item ?? missing();
  }

  async createGuardian(
    auth: AuthenticatedContext,
    input: CreateGuardianInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const guardianPhone = normalizedPhone(input.phone);
    const guardianTaxId = normalizedCpf(input.taxId)!;
    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const item = await transaction.guardian.create({
          data: {
            ...input,
            organizationId: orgId,
            phone: guardianPhone!,
            taxId: guardianTaxId,
          },
        });
        await this.audit(
          transaction,
          auth,
          "guardian.created",
          "Guardian",
          item.id,
          orgId,
          auditMetadata,
        );
        return item;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "GUARDIAN_TAX_ID_CONFLICT",
          message: "A guardian with this tax identifier already exists",
        });
      }
      throw error;
    }
  }

  async updateGuardian(
    auth: AuthenticatedContext,
    id: string,
    input: UpdateGuardianInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const guardianPhone =
      input.phone === undefined ? undefined : normalizedPhone(input.phone);
    const guardianTaxId =
      input.taxId === undefined ? undefined : normalizedCpf(input.taxId);
    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const exists = await transaction.guardian.findUnique({
          where: { organizationId_id: { organizationId: orgId, id } },
          select: { id: true },
        });
        if (!exists) {
          return missing();
        }
        const item = await transaction.guardian.update({
          where: { organizationId_id: { organizationId: orgId, id } },
          data: {
            ...input,
            phone: guardianPhone,
            taxId: guardianTaxId,
          },
        });
        await this.audit(
          transaction,
          auth,
          "guardian.updated",
          "Guardian",
          id,
          orgId,
          auditMetadata,
        );
        return item;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "GUARDIAN_TAX_ID_CONFLICT",
          message: "A guardian with this tax identifier already exists",
        });
      }
      throw error;
    }
  }

  async linkGuardian(
    auth: AuthenticatedContext,
    studentId: string,
    guardianId: string,
    relationship?: string,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (transaction) => {
      const [student, guardian] = await Promise.all([
        transaction.student.findUnique({
          where: { organizationId_id: { organizationId: orgId, id: studentId } },
          select: { id: true },
        }),
        transaction.guardian.findUnique({
          where: {
            organizationId_id: { organizationId: orgId, id: guardianId },
          },
          select: { id: true },
        }),
      ]);
      if (!student || !guardian) {
        return missing();
      }
      const item = await transaction.studentGuardian.upsert({
        where: {
          organizationId_studentId_guardianId: {
            organizationId: orgId,
            studentId,
            guardianId,
          },
        },
        create: { organizationId: orgId, studentId, guardianId, relationship },
        update: {
          active: true,
          endedAt: null,
          relationship,
          startedAt: new Date(),
        },
      });
      await this.audit(
        transaction,
        auth,
        "student_guardian.linked",
        "StudentGuardian",
        item.id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }

  async enrollments(auth: AuthenticatedContext, query: EnrollmentListInput) {
    const orgId = organizationId(auth);
    const where: Prisma.EnrollmentWhereInput = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { student: { name: { contains: query.search, mode: "insensitive" } } },
              {
                guardian: {
                  name: { contains: query.search, mode: "insensitive" },
                },
              },
              { plan: { name: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.enrollment.findMany({
        where,
        include: { student: true, guardian: true, plan: true },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.enrollment.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async enrollment(auth: AuthenticatedContext, id: string) {
    const item = await this.prisma.client.enrollment.findUnique({
      where: {
        organizationId_id: { organizationId: organizationId(auth), id },
      },
      include: { student: true, guardian: true, plan: true },
    });
    return item ?? missing();
  }

  async createEnrollment(
    auth: AuthenticatedContext,
    input: CreateEnrollmentInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`active-enrollment:${orgId}:${input.studentId}`}))`,
      );
      const [student, guardian, plan] = await Promise.all([
        transaction.student.findUnique({
          where: {
            organizationId_id: { organizationId: orgId, id: input.studentId },
          },
        }),
        transaction.guardian.findUnique({
          where: {
            organizationId_id: { organizationId: orgId, id: input.guardianId },
          },
        }),
        transaction.plan.findUnique({
          where: {
            organizationId_id: { organizationId: orgId, id: input.planId },
          },
        }),
      ]);
      if (
        !student ||
        student.status !== "ACTIVE" ||
        !guardian ||
        guardian.status !== "ACTIVE" ||
        !plan ||
        plan.status !== "ACTIVE"
      ) {
        return missing();
      }
      const linked = await transaction.studentGuardian.findUnique({
        where: {
          organizationId_studentId_guardianId: {
            organizationId: orgId,
            studentId: student.id,
            guardianId: guardian.id,
          },
        },
      });
      if (!linked?.active) {
        throw new BadRequestException({
          code: "GUARDIAN_LINK_REQUIRED",
          message: "Guardian must be linked to the student",
        });
      }

      const existingActiveEnrollment = await transaction.enrollment.findFirst({
        where: {
          organizationId: orgId,
          studentId: input.studentId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (existingActiveEnrollment) {
        throw new ConflictException({
          code: "ACTIVE_ENROLLMENT_EXISTS",
          message: "Student already has an active enrollment",
        });
      }

      const amountCents = input.amountCents ?? plan.amountCents;
      const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
      const endDate = input.endDate
        ? new Date(`${input.endDate}T00:00:00.000Z`)
        : undefined;
      validateEnrollmentValues(
        amountCents,
        input.discountCents,
        startDate,
        endDate,
      );
      const chargeOpenDay = input.chargeOpenDay ?? plan.chargeOpenDay;
      const chargeOpenTime = input.chargeOpenTime ?? plan.chargeOpenTime;
      const dueDay = input.dueDay ?? plan.dueDay;
      validateChargeWindow(chargeOpenDay, dueDay);
      const item = await transaction.enrollment.create({
        data: {
          organizationId: orgId,
          studentId: input.studentId,
          guardianId: input.guardianId,
          planId: input.planId,
          amountCents,
          chargeOpenDay,
          chargeOpenTime,
          dueDay,
          discountCents: input.discountCents,
          planNameSnapshot: plan.name,
          startDate,
          ...(endDate ? { endDate } : {}),
        },
      });
      await this.audit(
        transaction,
        auth,
        "enrollment.created",
        "Enrollment",
        item.id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }

  async createStudentEnrollment(
    auth: AuthenticatedContext,
    input: CreateStudentEnrollmentInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const studentCpf = normalizedCpf(input.student.cpf);
    const studentRg = input.student.rg
      ? normalizeRg(input.student.rg)
      : undefined;
    if (input.student.rg && !studentRg) {
      throw new BadRequestException({ code: "RG_INVALID", message: "RG is invalid" });
    }
    if (!studentCpf && !studentRg) {
      throw new BadRequestException({
        code: "STUDENT_DOCUMENT_REQUIRED",
        message: "CPF or RG is required",
      });
    }
    const studentPhone = normalizedPhone(input.student.phone);
    const guardianPhone = normalizedPhone(input.guardian.phone)!;
    const guardianTaxId = normalizedCpf(input.guardian.taxId)!;
    const birthDate = input.student.birthDate
      ? new Date(`${input.student.birthDate}T00:00:00.000Z`)
      : undefined;
    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`manual-enrollment:${orgId}:${studentCpf ?? studentRg}`}))`,
        );
        const plan = await transaction.plan.findUnique({
          where: { organizationId_id: { organizationId: orgId, id: input.planId } },
        });
        if (!plan || plan.status !== "ACTIVE") return missing();

        if (input.student.photoFileId) {
          const photo = await transaction.storedFile.findFirst({
            where: {
              id: input.student.photoFileId,
              organizationId: orgId,
              status: "ACTIVE",
              contentType: { in: ["image/jpeg", "image/png"] },
              studentPhoto: null,
            },
            select: { id: true },
          });
          if (!photo) {
            throw new BadRequestException({
              code: "STUDENT_PHOTO_INVALID",
              message: "Student photo is invalid",
            });
          }
        }

        const guardian = await transaction.guardian.create({
          data: {
            ...input.guardian,
            organizationId: orgId,
            phone: guardianPhone,
            taxId: guardianTaxId,
          },
        });
        const student = await transaction.student.create({
          data: {
            ...input.student,
            organizationId: orgId,
            cpf: studentCpf,
            rg: studentRg,
            birthDate,
            phone: studentPhone,
          },
        });
        const guardianLink = await transaction.studentGuardian.create({
          data: {
            organizationId: orgId,
            studentId: student.id,
            guardianId: guardian.id,
            relationship: input.relationship,
          },
        });
        const amountCents = input.amountCents ?? plan.amountCents;
        validateEnrollmentValues(amountCents, 0, startDate);
        const enrollment = await transaction.enrollment.create({
          data: {
            organizationId: orgId,
            studentId: student.id,
            guardianId: guardian.id,
            planId: plan.id,
            amountCents,
            chargeOpenDay: plan.chargeOpenDay,
            chargeOpenTime: plan.chargeOpenTime,
            dueDay: plan.dueDay,
            discountCents: 0,
            planNameSnapshot: plan.name,
            startDate,
          },
        });
        await this.audit(transaction, auth, "guardian.created", "Guardian", guardian.id, orgId, auditMetadata);
        await this.audit(transaction, auth, "student.created", "Student", student.id, orgId, auditMetadata);
        await this.audit(transaction, auth, "student.guardian_linked", "StudentGuardian", guardianLink.id, orgId, auditMetadata);
        await this.audit(transaction, auth, "enrollment.created", "Enrollment", enrollment.id, orgId, auditMetadata);
        return { student, guardian, enrollment };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "MANUAL_ENROLLMENT_CONFLICT",
          message: "Student or photo is already registered",
        });
      }
      throw error;
    }
  }

  async updateEnrollment(
    auth: AuthenticatedContext,
    id: string,
    input: UpdateEnrollmentInput,
    auditMetadata: OperationalAuditMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (transaction) => {
      const current = await transaction.enrollment.findUnique({
        where: { organizationId_id: { organizationId: orgId, id } },
      });
      if (!current) {
        return missing();
      }
      const endDate = input.endDate
        ? new Date(`${input.endDate}T00:00:00.000Z`)
        : current.endDate;
      validateEnrollmentValues(
        input.amountCents ?? current.amountCents,
        input.discountCents ?? current.discountCents,
        current.startDate,
        endDate,
      );
      validateChargeWindow(
        input.chargeOpenDay ?? current.chargeOpenDay,
        input.dueDay ?? current.dueDay,
      );
      const item = await transaction.enrollment.update({
        where: { organizationId_id: { organizationId: orgId, id } },
        data: {
          amountCents: input.amountCents,
          chargeOpenDay: input.chargeOpenDay,
          chargeOpenTime: input.chargeOpenTime,
          dueDay: input.dueDay,
          discountCents: input.discountCents,
          endDate,
          status: input.status,
        },
      });
      await this.audit(
        transaction,
        auth,
        "enrollment.updated",
        "Enrollment",
        id,
        orgId,
        auditMetadata,
      );
      return item;
    });
  }
}
