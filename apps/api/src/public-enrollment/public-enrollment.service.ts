import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  AuditActorType,
  Prisma,
  PublicEnrollmentSubmissionStatus,
  StoredFileStatus,
} from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import {
  normalizeBrazilianPhone,
  normalizeCpf,
  normalizeRg,
} from "../common/brazilian-documents";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { FilesService } from "../files/files.service";
import { FinancialService } from "../financial/financial.service";
import {
  defaultPublicEnrollmentFieldConfiguration,
  publicEnrollmentFieldConfigurationSchema,
  type PublicEnrollmentFieldConfiguration,
  type SubmitPublicEnrollmentInput,
  type UpdatePublicEnrollmentFormInput,
} from "./public-enrollment.dto";

export type PublicEnrollmentRequestMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

const PRIVACY_NOTICE_VERSION = "2026-08-01";
const TOKEN_PREFIX = "mensaly-public-enrollment";

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function auditMetadata(metadata: PublicEnrollmentRequestMetadata) {
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

function canonicalRequest(input: SubmitPublicEnrollmentInput): string {
  const sortValues = (values: Record<string, string>) => Object.fromEntries(
    Object.entries(values).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return JSON.stringify({
    ...input,
    studentValues: sortValues(input.studentValues),
    guardianValues: sortValues(input.guardianValues),
    companyWebsite: "",
  });
}

function localDate(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000Z`);
}

type PendingStudentPayload = {
  name: string;
  birthDate?: string;
  phone?: string;
};

type PendingGuardianPayload = {
  name: string;
  phone: string;
  relationship?: string;
  selfResponsible?: boolean;
};

type SubmissionFieldValues = {
  studentValues: Record<string, string>;
  guardianValues: Record<string, string>;
};

function submissionFieldValues(value: Prisma.JsonValue | null): SubmissionFieldValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { studentValues: {}, guardianValues: {} };
  }
  const record = value as Record<string, unknown>;
  if ("studentValues" in record || "guardianValues" in record) {
    return {
      studentValues: (record.studentValues ?? {}) as Record<string, string>,
      guardianValues: (record.guardianValues ?? {}) as Record<string, string>,
    };
  }
  return { studentValues: record as Record<string, string>, guardianValues: {} };
}

function pendingStudentName(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  ) {
    return value.name;
  }
  return "Aluno";
}

@Injectable()
export class PublicEnrollmentService {
  private readonly environment = parseEnvironment(
    apiEnvironmentSchema,
    process.env,
  );

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(FinancialService) private readonly financial: FinancialService,
  ) {}

  private secret(): string {
    if (this.environment.PUBLIC_ENROLLMENT_LINK_SECRET) {
      return this.environment.PUBLIC_ENROLLMENT_LINK_SECRET;
    }
    if (this.environment.NODE_ENV !== "production") {
      return Buffer.alloc(32, 17).toString("base64");
    }
    throw new ServiceUnavailableException({
      code: "PUBLIC_ENROLLMENT_NOT_CONFIGURED",
      message: "Public enrollment is not configured",
    });
  }

  private signature(formId: string, nonce: string): Buffer {
    return createHmac("sha256", Buffer.from(this.secret(), "base64"))
      .update(`${TOKEN_PREFIX}:${formId}:${nonce}`)
      .digest();
  }

  private token(formId: string, nonce: string): string {
    return `${formId}.${nonce}.${this.signature(formId, nonce).toString("base64url")}`;
  }

  private parseToken(token: string): { formId: string; nonce: string } {
    const [formId, nonce, encodedSignature, extra] = token.split(".");
    if (
      extra ||
      !formId ||
      !nonce ||
      !encodedSignature ||
      !/^[0-9a-f-]{36}$/i.test(formId)
    ) {
      return this.invalidToken();
    }
    let received: Buffer;
    try {
      received = Buffer.from(encodedSignature, "base64url");
    } catch {
      return this.invalidToken();
    }
    const expected = this.signature(formId, nonce);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return this.invalidToken();
    }
    return { formId, nonce };
  }

  private invalidToken(): never {
    throw new NotFoundException({
      code: "PUBLIC_ENROLLMENT_LINK_INVALID",
      message: "Este link de cadastro não está disponível.",
    });
  }

  private link(form: { id: string; nonce: string }): string {
    return new URL(
      `/cadastro-aluno/${this.token(form.id, form.nonce)}`,
      this.environment.WEB_APP_URL,
    ).toString();
  }

  private parsedConfiguration(
    value: Prisma.JsonValue,
  ): PublicEnrollmentFieldConfiguration {
    return publicEnrollmentFieldConfigurationSchema.parse(value);
  }

  async getOwn(auth: AuthenticatedContext) {
    const form = await this.prisma.client.publicEnrollmentForm.findUnique({
      where: { organizationId: organizationId(auth) },
    });
    if (!form) return { configured: false };
    return {
      configured: true,
      active: form.active,
      link: this.link(form),
      fieldConfiguration: this.parsedConfiguration(form.fieldConfiguration),
      privacyNoticeVersion: form.privacyNoticeVersion,
      updatedAt: form.updatedAt,
    };
  }

  async create(
    auth: AuthenticatedContext,
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-form:${orgId}`}))`,
      );
      const existing = await tx.publicEnrollmentForm.findUnique({
        where: { organizationId: orgId },
      });
      if (existing) {
        return {
          configured: true,
          active: existing.active,
          link: this.link(existing),
          fieldConfiguration: this.parsedConfiguration(
            existing.fieldConfiguration,
          ),
          privacyNoticeVersion: existing.privacyNoticeVersion,
          updatedAt: existing.updatedAt,
        };
      }
      const form = await tx.publicEnrollmentForm.create({
        data: {
          organizationId: orgId,
          nonce: randomBytes(24).toString("base64url"),
          fieldConfiguration: defaultPublicEnrollmentFieldConfiguration,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "public_enrollment_form.created",
          entityType: "PublicEnrollmentForm",
          entityId: form.id,
          after: { active: true },
          ...auditMetadata(metadata),
        },
      });
      return {
        configured: true,
        active: form.active,
        link: this.link(form),
        fieldConfiguration: this.parsedConfiguration(form.fieldConfiguration),
        privacyNoticeVersion: form.privacyNoticeVersion,
        updatedAt: form.updatedAt,
      };
    });
  }

  async update(
    auth: AuthenticatedContext,
    input: UpdatePublicEnrollmentFormInput,
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.publicEnrollmentForm.findUnique({
        where: { organizationId: orgId },
      });
      if (!current)
        throw new NotFoundException({
          code: "PUBLIC_ENROLLMENT_FORM_NOT_FOUND",
          message: "Gere o link de cadastro primeiro.",
        });
      const configuration = {
        ...this.parsedConfiguration(current.fieldConfiguration),
        ...(input.fieldConfiguration ?? {}),
      };
      const form = await tx.publicEnrollmentForm.update({
        where: { organizationId: orgId },
        data: {
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.fieldConfiguration
            ? { fieldConfiguration: configuration }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "public_enrollment_form.updated",
          entityType: "PublicEnrollmentForm",
          entityId: form.id,
          before: {
            active: current.active,
            fieldConfiguration: current.fieldConfiguration,
          },
          after: {
            active: form.active,
            fieldConfiguration: form.fieldConfiguration,
          },
          ...auditMetadata(metadata),
        },
      });
      return {
        configured: true,
        active: form.active,
        link: this.link(form),
        fieldConfiguration: this.parsedConfiguration(form.fieldConfiguration),
        privacyNoticeVersion: form.privacyNoticeVersion,
        updatedAt: form.updatedAt,
      };
    });
  }

  async rotate(
    auth: AuthenticatedContext,
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const form = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.publicEnrollmentForm.findUnique({
        where: { organizationId: orgId },
      });
      if (!current)
        throw new NotFoundException({
          code: "PUBLIC_ENROLLMENT_FORM_NOT_FOUND",
          message: "Gere o link de cadastro primeiro.",
        });
      const updated = await tx.publicEnrollmentForm.update({
        where: { organizationId: orgId },
        data: {
          nonce: randomBytes(24).toString("base64url"),
          active: current.active,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "public_enrollment_form.rotated",
          entityType: "PublicEnrollmentForm",
          entityId: updated.id,
          after: { active: current.active },
          ...auditMetadata(metadata),
        },
      });
      return updated;
    });
    return { ...(await this.getOwn(auth)), link: this.link(form) };
  }

  private async publicForm(token: string) {
    const parsed = this.parseToken(token);
    const form = await this.prisma.client.publicEnrollmentForm.findFirst({
      where: {
        id: parsed.formId,
        nonce: parsed.nonce,
        active: true,
        organization: { status: "ACTIVE" },
      },
      include: { organization: true },
    });
    if (!form) return this.invalidToken();
    return form;
  }

  private async assertApprovalQueueEnabled(organizationId: string) {
    const form = await this.prisma.client.publicEnrollmentForm.findFirst({
      where: { organizationId },
      select: { active: true, fieldConfiguration: true },
    });
    const enabled = form?.active &&
      this.parsedConfiguration(form.fieldConfiguration).approvalMode === "SAFE";
    if (!enabled) {
      throw new GoneException({
        code: "PUBLIC_ENROLLMENT_APPROVALS_DISABLED",
        message: "As solicitações de cadastro não estão ativas para esta conta.",
      });
    }
  }

  async publicConfiguration(token: string) {
    const form = await this.publicForm(token);
    const [fields, plans] = await Promise.all([
      this.prisma.client.customField.findMany({
        where: { organizationId: form.organizationId, active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.client.plan.findMany({
        where: { organizationId: form.organizationId, status: "ACTIVE" },
        orderBy: { name: "asc" },
      }),
    ]);
    const brand = (form.organization.brand ?? {}) as Record<string, unknown>;
    const address = (form.organization.address ?? {}) as Record<
      string,
      unknown
    >;
    return {
      business: {
        name: form.organization.name,
        logoDataUrl:
          typeof brand.logoDataUrl === "string" ? brand.logoDataUrl : null,
        brandColor:
          typeof brand.primaryColor === "string" ? brand.primaryColor : null,
        city: typeof address.city === "string" ? address.city : "",
        segment: typeof brand.segment === "string" ? brand.segment : "",
      },
      fieldConfiguration: this.parsedConfiguration(form.fieldConfiguration),
      fields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.fieldType,
        subject: field.subject,
        options: Array.isArray(field.options) ? field.options : [],
        required: field.required,
      })),
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description ?? "",
        amountCents: plan.amountCents,
        dueDay: plan.dueDay,
      })),
      privacyNoticeVersion: form.privacyNoticeVersion,
      privacyNotice: `Ao enviar, você declara que os dados são verdadeiros e autoriza ${form.organization.name} a utilizá-los para cadastro, matrícula, cobrança e comunicação operacional.`,
    };
  }

  async uploadStudentPhoto(
    token: string,
    input: { filename: string; contentType: string; body: Buffer },
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    const form = await this.publicForm(token);
    return this.files.uploadPublicStudentPhoto(
      form.organizationId,
      input,
      metadata,
    );
  }

  async listSubmissions(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    await this.assertApprovalQueueEnabled(orgId);
    const submissions = await this.prisma.client.publicEnrollmentSubmission.findMany({
      where: { organizationId: orgId },
      include: { photoFile: true, student: true, guardian: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    const plans = await this.prisma.client.plan.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, amountCents: true, dueDay: true },
    });
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    return submissions.map((submission) => ({
      id: submission.id,
      status: submission.status,
      createdAt: submission.createdAt.toISOString(),
      student: submission.student
        ? { name: submission.student.name }
        : {
            name: pendingStudentName(submission.studentPayload),
            cpf: submission.studentCpf,
            rg: submission.studentRg,
            ...(submission.studentPayload as PendingStudentPayload | null),
          },
      guardian: submission.guardian
        ? { name: submission.guardian.name, phone: submission.guardian.phone }
        : {
            cpf: submission.guardianCpf,
            ...(submission.guardianPayload as PendingGuardianPayload | null),
          },
      plan: submission.planId ? (planById.get(submission.planId) ?? null) : null,
      values: submissionFieldValues(submission.customFieldValues),
      photo: submission.photoFile
        ? {
            id: submission.photoFile.id,
            contentType: submission.photoFile.contentType,
            sizeBytes: submission.photoFile.sizeBytes,
          }
        : null,
    }));
  }

  async approve(
    auth: AuthenticatedContext,
    submissionId: string,
    metadata: PublicEnrollmentRequestMetadata = {},
    options: { allowAutomatic?: boolean } = {},
  ) {
    const orgId = organizationId(auth);
    if (!options.allowAutomatic) await this.assertApprovalQueueEnabled(orgId);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-approval:${orgId}:${submissionId}`}))`,
      );
      const submission = await tx.publicEnrollmentSubmission.findFirst({
        where: {
          id: submissionId,
          organizationId: orgId,
          status: PublicEnrollmentSubmissionStatus.PENDING,
        },
      });
      if (!submission) {
        throw new NotFoundException({
          code: "PUBLIC_ENROLLMENT_SUBMISSION_NOT_FOUND",
          message: "Solicitação de cadastro não encontrada.",
        });
      }
      const student = submission.studentPayload as PendingStudentPayload | null;
      const guardian = submission.guardianPayload as PendingGuardianPayload | null;
      if (
        !student?.name ||
        !guardian?.name ||
        !guardian.phone ||
        !submission.planId ||
        !submission.photoFileId ||
        (!submission.studentCpf && !submission.studentRg) ||
        !submission.guardianCpf
      ) {
        throw new ConflictException({
          code: "PUBLIC_ENROLLMENT_SUBMISSION_INVALID",
          message: "A solicitação não possui os dados necessários para aprovação.",
        });
      }
      const documentKey = submission.studentCpf
        ? `CPF:${submission.studentCpf}`
        : `RG:${submission.studentRg}`;
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-student:${orgId}:${documentKey}`}))`,
      );
      const duplicate = await tx.student.findFirst({
        where: {
          organizationId: orgId,
          OR: [
            ...(submission.studentCpf ? [{ cpf: submission.studentCpf }] : []),
            ...(submission.studentRg ? [{ rg: submission.studentRg }] : []),
          ],
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          code: "STUDENT_ALREADY_REGISTERED",
          message: "Já existe um aluno cadastrado com este documento.",
        });
      }
      const plan = await tx.plan.findFirst({
        where: { id: submission.planId, organizationId: orgId, status: "ACTIVE" },
      });
      if (!plan) {
        throw new GoneException({
          code: "PLAN_NOT_AVAILABLE",
          message: "O plano selecionado não está mais disponível.",
        });
      }
      const photo = await tx.storedFile.findFirst({
        where: {
          id: submission.photoFileId,
          organizationId: orgId,
          uploadedByUserId: null,
          status: StoredFileStatus.ACTIVE,
          studentPhoto: null,
        },
        select: { id: true },
      });
      if (!photo) {
        throw new ConflictException({
          code: "STUDENT_PHOTO_INVALID",
          message: "A foto desta solicitação não está disponível.",
        });
      }
      const guardianRecord = await tx.guardian.create({
        data: {
          organizationId: orgId,
          name: guardian.name,
          taxId: submission.guardianCpf,
          phone: guardian.phone,
        },
      });
      const activeFields = await tx.customField.findMany({
        where: { organizationId: orgId, active: true },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { timezone: true },
      });
      const values = submissionFieldValues(submission.customFieldValues);
      const allValues = { ...values.studentValues, ...values.guardianValues };
      if (Object.keys(allValues).some((id) => !activeFields.some((field) => field.id === id))) {
        throw new ConflictException({
          code: "CUSTOM_FIELD_INVALID",
          message: "Um campo adicional desta solicitação não está mais disponível.",
        });
      }
      const missing = activeFields.find((field) =>
        field.required && !(guardian.selfResponsible && field.subject === "GUARDIAN") && !(field.subject === "STUDENT" ? values.studentValues : values.guardianValues)[field.id]?.trim(),
      );
      if (missing) {
        throw new ConflictException({
          code: "CUSTOM_FIELD_REQUIRED",
          message: `${missing.label} agora é obrigatório. Solicite um novo cadastro.`,
        });
      }
      const studentRecord = await tx.student.create({
        data: {
          organizationId: orgId,
          name: student.name,
          cpf: submission.studentCpf,
          rg: submission.studentRg,
          birthDate: student.birthDate ? new Date(`${student.birthDate}T00:00:00.000Z`) : undefined,
          phone: student.phone,
          photoFileId: photo.id,
        },
      });
      await tx.studentGuardian.create({
        data: {
          organizationId: orgId,
          studentId: studentRecord.id,
          guardianId: guardianRecord.id,
          relationship: guardian.relationship ?? "Responsável financeiro",
        },
      });
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId: orgId,
          studentId: studentRecord.id,
          guardianId: guardianRecord.id,
          planId: plan.id,
          amountCents: plan.amountCents,
          chargeOpenDay: plan.chargeOpenDay,
          chargeOpenTime: plan.chargeOpenTime,
          dueDay: plan.dueDay,
          discountCents: 0,
          startDate: localDate(organization.timezone),
          planNameSnapshot: plan.name,
        },
      });
      await this.financial.createAutomaticChargesForEnrollment(tx, {
        organizationId: orgId,
        enrollment,
        timezone: organization.timezone,
        actorUserId: auth.userId,
        metadata,
      });
      const studentFieldRows = Object.entries(values.studentValues).filter(([, value]) => value.trim());
      if (studentFieldRows.length) {
        await tx.studentFieldValue.createMany({
          data: studentFieldRows.map(([fieldId, value]) => ({
            organizationId: orgId,
            studentId: studentRecord.id,
            fieldId,
            value,
          })),
        });
      }
      const guardianFieldRows = Object.entries(values.guardianValues).filter(([, value]) => value.trim());
      if (guardianFieldRows.length) {
        await tx.guardianFieldValue.createMany({
          data: guardianFieldRows.map(([fieldId, value]) => ({
            organizationId: orgId,
            guardianId: guardianRecord.id,
            fieldId,
            value,
          })),
        });
      }
      await tx.publicEnrollmentSubmission.update({
        where: { id: submission.id },
        data: {
          status: PublicEnrollmentSubmissionStatus.APPROVED,
          studentId: studentRecord.id,
          guardianId: guardianRecord.id,
          enrollmentId: enrollment.id,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "public_enrollment.approved",
          entityType: "PublicEnrollmentSubmission",
          entityId: submission.id,
          after: { planId: plan.id, enrollmentId: enrollment.id },
          ...auditMetadata(metadata),
        },
      });
      return { id: submission.id, status: PublicEnrollmentSubmissionStatus.APPROVED, studentName: studentRecord.name };
    });
  }

  async reject(
    auth: AuthenticatedContext,
    submissionId: string,
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    await this.assertApprovalQueueEnabled(orgId);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-reject:${orgId}:${submissionId}`}))`,
      );
      const submission = await tx.publicEnrollmentSubmission.findFirst({
        where: { id: submissionId, organizationId: orgId, status: PublicEnrollmentSubmissionStatus.PENDING },
        include: { photoFile: true },
      });
      if (!submission || !submission.photoFile) {
        throw new NotFoundException({
          code: "PUBLIC_ENROLLMENT_SUBMISSION_NOT_FOUND",
          message: "Solicitação de cadastro não encontrada.",
        });
      }
      await this.files.deletePublicStudentPhotoObject({
        organizationId: orgId,
        id: submission.photoFile.id,
        storageKey: submission.photoFile.storageKey,
      });
      await tx.publicEnrollmentSubmission.delete({ where: { id: submission.id } });
      await tx.storedFile.delete({ where: { id: submission.photoFile.id } });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "public_enrollment.rejected_and_deleted",
          entityType: "PublicEnrollmentSubmission",
          entityId: submission.id,
          after: { permanentlyDeleted: true },
          ...auditMetadata(metadata),
        },
      });
      return { id: submission.id, deleted: true };
    });
  }

  async submit(
    token: string,
    idempotencyKey: string,
    input: SubmitPublicEnrollmentInput,
    metadata: PublicEnrollmentRequestMetadata = {},
  ) {
    if (input.companyWebsite)
      return {
        accepted: true,
        status: PublicEnrollmentSubmissionStatus.PENDING,
        studentName: "",
        submissionId: "",
        replayed: false,
      };
    const form = await this.publicForm(token);
    if (input.privacyNoticeVersion !== form.privacyNoticeVersion) {
      throw new ConflictException({
        code: "PRIVACY_NOTICE_CHANGED",
        message:
          "O aviso de privacidade foi atualizado. Revise e envie novamente.",
      });
    }
    const configuration = this.parsedConfiguration(form.fieldConfiguration);
    const requiredValues: Array<[boolean, unknown, string]> = [
      [
        configuration.studentBirthDateRequired,
        input.student.birthDate,
        "Data de nascimento",
      ],
      [
        configuration.studentPhoneRequired,
        input.student.phone,
        "Telefone do aluno",
      ],
      [
        configuration.relationshipRequired && !input.selfResponsible,
        input.guardian.relationship,
        "Parentesco",
      ],
    ];
    const missingStandard = requiredValues.find(
      ([required, value]) => required && !value,
    );
    if (missingStandard) {
      throw new BadRequestException({
        code: "PUBLIC_ENROLLMENT_FIELD_REQUIRED",
        message: `${missingStandard[2]} é obrigatório.`,
      });
    }

    const studentCpf = normalizeCpf(input.student.document.value);
    const studentRg = studentCpf
      ? null
      : normalizeRg(input.student.document.value);
    const studentPhone = input.student.phone
      ? normalizeBrazilianPhone(input.student.phone)
      : null;
    const guardianCpf = input.selfResponsible
      ? studentCpf
      : normalizeCpf(input.guardian.cpf);
    const guardianPhone = input.selfResponsible
      ? studentPhone
      : normalizeBrazilianPhone(input.guardian.phone);
    if (!studentCpf && !studentRg)
      throw new BadRequestException({
        code: "RG_INVALID",
        message: "Informe um CPF válido ou RG válido do aluno.",
      });
    if (!guardianCpf)
      throw new BadRequestException({
        code: "CPF_INVALID",
        message: "O CPF do responsável é inválido.",
      });
    if (!guardianPhone)
      throw new BadRequestException({
        code: "PHONE_INVALID",
        message: "O WhatsApp do responsável é inválido.",
      });
    if (input.student.phone && !studentPhone)
      throw new BadRequestException({
        code: "PHONE_INVALID",
        message: "O telefone do aluno é inválido.",
      });

    const requestHash = createHash("sha256")
      .update(canonicalRequest(input))
      .digest("hex");
    const ipHash = createHmac("sha256", Buffer.from(this.secret(), "base64"))
      .update(metadata.ipAddress ?? "unknown")
      .digest("hex");

    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-idempotency:${form.id}:${idempotencyKey}`}))`,
      );
      const replay = await tx.publicEnrollmentSubmission.findUnique({
        where: { formId_idempotencyKey: { formId: form.id, idempotencyKey } },
        include: { student: true },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "A tentativa já foi usada com outros dados.",
          });
        return {
          accepted: true,
          status: replay.status,
          studentName:
            replay.student?.name ?? pendingStudentName(replay.studentPayload),
          submissionId: replay.id,
          replayed: true,
        };
      }

      const documentKey = studentCpf ? `CPF:${studentCpf}` : `RG:${studentRg}`;
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-enrollment-student:${form.organizationId}:${documentKey}`}))`,
      );
      const duplicate = await tx.student.findFirst({
        where: {
          organizationId: form.organizationId,
          OR: [
            ...(studentCpf ? [{ cpf: studentCpf }] : []),
            ...(studentRg ? [{ rg: studentRg }] : []),
          ],
        },
        select: { id: true },
      });
      if (duplicate)
        throw new ConflictException({
          code: "STUDENT_ALREADY_REGISTERED",
          message:
            "Já existe um aluno cadastrado com este documento. Fale com o local.",
        });
      const pendingDuplicate = await tx.publicEnrollmentSubmission.findFirst({
        where: {
          organizationId: form.organizationId,
          status: PublicEnrollmentSubmissionStatus.PENDING,
          OR: [
            ...(studentCpf ? [{ studentCpf }] : []),
            ...(studentRg ? [{ studentRg }] : []),
          ],
        },
        select: { id: true },
      });
      if (pendingDuplicate)
        throw new ConflictException({
          code: "STUDENT_ALREADY_REGISTERED",
          message:
            "Já existe uma solicitação de cadastro com este documento. Fale com o local.",
        });

      const photo = await tx.storedFile.findFirst({
        where: {
          id: input.student.photoFileId,
          organizationId: form.organizationId,
          uploadedByUserId: null,
          status: StoredFileStatus.ACTIVE,
          contentType: { in: ["image/jpeg", "image/png"] },
          studentPhoto: null,
          publicEnrollmentPhotos: { none: {} },
        },
        select: { id: true },
      });
      if (!photo) {
        throw new BadRequestException({
          code: "STUDENT_PHOTO_INVALID",
          message: "Envie novamente a foto do aluno antes de concluir.",
        });
      }

      const plan = await tx.plan.findFirst({
        where: {
          id: input.planId,
          organizationId: form.organizationId,
          status: "ACTIVE",
        },
      });
      if (!plan)
        throw new GoneException({
          code: "PLAN_NOT_AVAILABLE",
          message: "O plano selecionado não está mais disponível.",
        });

      const fields = await tx.customField.findMany({
        where: { organizationId: form.organizationId, active: true },
      });
      const fieldById = new Map(fields.map((field) => [field.id, field]));
      const allInputValues = { ...input.studentValues, ...input.guardianValues };
      if (Object.keys(allInputValues).some((fieldId) => !fieldById.has(fieldId))) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_INVALID",
          message: "Um ou mais campos adicionais são inválidos.",
        });
      }
      const missingCustom = fields.find(
        (field) => field.required && !(input.selfResponsible && field.subject === "GUARDIAN") && !(field.subject === "STUDENT" ? input.studentValues : input.guardianValues)[field.id]?.trim(),
      );
      if (missingCustom)
        throw new BadRequestException({
          code: "CUSTOM_FIELD_REQUIRED",
          message: `${missingCustom.label} é obrigatório.`,
        });
      const invalidCustom = fields.find((field) => {
        if (input.selfResponsible && field.subject === "GUARDIAN") return false;
        const value = (field.subject === "STUDENT" ? input.studentValues : input.guardianValues)[field.id]?.trim();
        if (!value) return false;
        if (field.fieldType === "NUMBER")
          return !/^-?\d+(?:[.,]\d+)?$/.test(value);
        if (field.fieldType === "DATE")
          return !/^\d{4}-\d{2}-\d{2}$/.test(value);
        if (field.fieldType === "BOOLEAN")
          return value !== "true" && value !== "false";
        if (field.fieldType === "SELECT") {
          const options = Array.isArray(field.options) ? field.options : [];
          return !options.includes(value);
        }
        return false;
      });
      if (invalidCustom) {
        throw new BadRequestException({
          code: "CUSTOM_FIELD_VALUE_INVALID",
          message: `${invalidCustom.label} possui um valor inválido.`,
        });
      }

      const submission = await tx.publicEnrollmentSubmission.create({
        data: {
          organizationId: form.organizationId,
          formId: form.id,
          status: PublicEnrollmentSubmissionStatus.PENDING,
          studentCpf,
          studentRg,
          guardianCpf,
          studentPayload: {
            name: input.student.name,
            ...(input.student.birthDate
              ? { birthDate: input.student.birthDate }
              : {}),
            ...(studentPhone ? { phone: studentPhone } : {}),
          },
          guardianPayload: {
            name: input.selfResponsible ? input.student.name : input.guardian.name,
            phone: guardianPhone,
            selfResponsible: input.selfResponsible,
            ...(input.selfResponsible ? { relationship: "Próprio aluno" } : input.guardian.relationship
              ? { relationship: input.guardian.relationship }
              : {}),
          },
          planId: plan.id,
          customFieldValues: {
            studentValues: input.studentValues,
            guardianValues: input.guardianValues,
          },
          photoFileId: photo.id,
          idempotencyKey,
          requestHash,
          consentVersion: form.privacyNoticeVersion,
          consentedAt: new Date(),
          ipHash,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: form.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "public_enrollment.submitted",
          entityType: "PublicEnrollmentSubmission",
          entityId: submission.id,
          after: {
            formId: form.id,
            planId: plan.id,
            consentVersion: form.privacyNoticeVersion,
            status: PublicEnrollmentSubmissionStatus.PENDING,
          },
          ...(metadata.correlationId
            ? { correlationId: metadata.correlationId }
            : {}),
          ipAddress: ipHash,
          ...(metadata.userAgent
            ? { userAgent: metadata.userAgent.slice(0, 1_024) }
            : {}),
        },
      });
        return {
          accepted: true,
          status: PublicEnrollmentSubmissionStatus.PENDING,
          studentName: input.student.name,
        submissionId: submission.id,
        replayed: false,
      };
    });

    if (
      configuration.approvalMode === "AUTOMATIC" &&
      result.status === PublicEnrollmentSubmissionStatus.PENDING &&
      result.submissionId
    ) {
      const organization = await this.prisma.client.organization.findUniqueOrThrow({
        where: { id: form.organizationId },
        select: { ownerUserId: true, owner: { select: { email: true } } },
      });
      const approved = await this.approve(
        {
          userId: organization.ownerUserId,
          email: organization.owner.email,
          role: "COMPANY_ACCOUNT",
          organizationId: form.organizationId,
        },
        result.submissionId,
        metadata,
        { allowAutomatic: true },
      );
      return { ...result, status: approved.status };
    }

    return result;
  }
}
