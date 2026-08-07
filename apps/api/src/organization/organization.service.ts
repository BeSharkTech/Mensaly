import { AuditActorType, OrganizationStatus, Prisma, UserRole } from "@mensaly/database";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import type { AuthenticatedContext } from "../authorization/authorization-context";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from "./organization.dto";

type CurrentUser = {
  id: string;
  role: AuthenticatedContext["role"];
};

type RequestMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

function normalizeTaxId(value: string): string {
  const taxId = value.replace(/\D/g, "");
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new ConflictException({
      code: "TAX_ID_INVALID",
      message: "Tax ID must contain a valid CPF or CNPJ length",
    });
  }
  return taxId;
}

function normalizePhone(value: string): string {
  const phone = value.replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) {
    throw new ConflictException({
      code: "PHONE_INVALID",
      message: "Phone must contain between 10 and 15 digits",
    });
  }
  return phone;
}

function validTimezone(value: string): string {
  if (!Intl.supportedValuesOf("timeZone").includes(value)) {
    throw new ConflictException({
      code: "TIMEZONE_INVALID",
      message: "Timezone must be a valid IANA timezone",
    });
  }
  return value;
}

function metadata(input: RequestMetadata): RequestMetadata {
  return {
    ...(input.ipAddress ? { ipAddress: input.ipAddress.slice(0, 64) } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 1_024) } : {}),
  };
}

function validatedCreate(input: unknown): CreateOrganizationInput {
  const result = createOrganizationSchema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "Confira os dados informados.",
    details: result.error.issues.map((issue) => ({
      field: issue.path.join(".") || undefined,
      message: issue.message,
    })),
  });
}

function validatedUpdate(input: unknown): UpdateOrganizationInput {
  const result = updateOrganizationSchema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "Confira os dados informados.",
    details: result.error.issues.map((issue) => ({
      field: issue.path.join(".") || undefined,
      message: issue.message,
    })),
  });
}

function organizationView(organization: {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  address: Prisma.JsonValue | null;
  timezone: string;
  status: OrganizationStatus;
  brand: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return organization;
}

@Injectable()
export class OrganizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertCompanyAccount(user: CurrentUser): void {
    if (user.role !== UserRole.COMPANY_ACCOUNT) {
      throw new ForbiddenException({
        code: "COMPANY_ACCOUNT_REQUIRED",
        message: "A company account is required",
      });
    }
  }

  async create(
    auth: AuthenticatedContext,
    rawInput: unknown,
    requestMetadata: RequestMetadata,
  ) {
    const user: CurrentUser = { id: auth.userId, role: auth.role };
    this.assertCompanyAccount(user);
    const input = validatedCreate(rawInput);
    const taxId = input.taxId ? normalizeTaxId(input.taxId) : undefined;
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const timezone = validTimezone(input.timezone ?? "America/Sao_Paulo");

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`organization:${user.id}`}))
        `;
        const existing = await transaction.organization.findUnique({
          where: { ownerUserId: user.id },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            code: "ORGANIZATION_ALREADY_EXISTS",
            message: "This account already owns an organization",
          });
        }

        const organization = await transaction.organization.create({
          data: {
            ownerUserId: user.id,
            name: input.name,
            ...(input.legalName ? { legalName: input.legalName } : {}),
            ...(taxId ? { taxId } : {}),
            ...(phone ? { phone } : {}),
            timezone,
            ...(input.address ? { address: input.address } : {}),
            ...(input.brand ? { brand: input.brand } : {}),
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id,
            actorUserId: user.id,
            actorType: AuditActorType.USER,
            action: "organization.created",
            entityType: "Organization",
            entityId: organization.id,
            after: {
              name: organization.name,
              taxId: organization.taxId,
              status: organization.status,
            },
            ...metadata(requestMetadata),
          },
        });
        return organizationView(organization);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({
          code: "TAX_ID_ALREADY_REGISTERED",
          message: "This CPF or CNPJ is already registered",
        });
      }
      throw error;
    }
  }

  async getOwn(auth: AuthenticatedContext) {
    const user: CurrentUser = { id: auth.userId, role: auth.role };
    this.assertCompanyAccount(user);
    if (!auth.organizationId) {
      throw new NotFoundException({
        code: "ORGANIZATION_NOT_FOUND",
        message: "No organization exists for this account",
      });
    }
    const organization = await this.prisma.client.organization.findFirst({
      where: { id: auth.organizationId, ownerUserId: user.id },
    });
    if (!organization) {
      throw new NotFoundException({
        code: "ORGANIZATION_NOT_FOUND",
        message: "No organization exists for this account",
      });
    }
    return organizationView(organization);
  }

  async update(
    auth: AuthenticatedContext,
    rawInput: unknown,
    requestMetadata: RequestMetadata,
  ) {
    const user: CurrentUser = { id: auth.userId, role: auth.role };
    this.assertCompanyAccount(user);
    const input = validatedUpdate(rawInput);
    if (!auth.organizationId) {
      throw new NotFoundException({
        code: "ORGANIZATION_NOT_FOUND",
        message: "No organization exists for this account",
      });
    }
    const current = await this.prisma.client.organization.findFirst({
      where: { id: auth.organizationId, ownerUserId: user.id },
    });
    if (!current) {
      throw new NotFoundException({
        code: "ORGANIZATION_NOT_FOUND",
        message: "No organization exists for this account",
      });
    }

    const data: Prisma.OrganizationUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.taxId !== undefined ? { taxId: normalizeTaxId(input.taxId) } : {}),
      ...(input.phone !== undefined ? { phone: normalizePhone(input.phone) } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.timezone !== undefined ? { timezone: validTimezone(input.timezone) } : {}),
    };

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const organization = await transaction.organization.update({
          where: { id: current.id, ownerUserId: user.id },
          data,
        });
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id,
            actorUserId: user.id,
            actorType: AuditActorType.USER,
            action: "organization.updated",
            entityType: "Organization",
            entityId: organization.id,
            before: {
              name: current.name,
              taxId: current.taxId,
              phone: current.phone,
              timezone: current.timezone,
            },
            after: {
              name: organization.name,
              taxId: organization.taxId,
              phone: organization.phone,
              timezone: organization.timezone,
            },
            ...metadata(requestMetadata),
          },
        });
        return organizationView(organization);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({
          code: "TAX_ID_ALREADY_REGISTERED",
          message: "This CPF or CNPJ is already registered",
        });
      }
      throw error;
    }
  }
}
