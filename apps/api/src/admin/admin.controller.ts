import {
  AuditActorType,
  OrganizationStatus,
  Prisma,
} from "@mensaly/database";
import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  PlatformAdminGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../infrastructure/database/prisma.service";
import {
  OrganizationStatusDto,
  organizationStatusSchema,
} from "./organization-status.dto";

@ApiTags("Platform administration")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("session")
  @ApiOperation({ summary: "Gets the platform administrator session" })
  @ApiOkResponse({
    description:
      "Authenticated platform administrator session without organization context",
  })
  @ApiUnauthorizedResponse({
    description: "A valid platform administrator session is required",
  })
  session(@CurrentAuth() auth: AuthenticatedContext): { data: unknown } {
    return {
      data: {
        id: auth.userId,
        email: auth.email,
        role: auth.role,
        organizationId: auth.organizationId ?? null,
      },
    };
  }

  @Patch("organizations/:id/status")
  @ApiOperation({ summary: "Updates an organization status" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["ACTIVE", "INACTIVE", "BLOCKED"] },
      },
    },
  })
  async updateOrganizationStatus(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(organizationStatusSchema))
    input: OrganizationStatusDto,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    const value = input as unknown as { status: OrganizationStatus };
    const organization = await this.prisma.client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`organization-status:${id}`}))`,
        );
        const current = await transaction.organization.findUnique({
          where: { id },
        });
        if (!current) {
          throw new NotFoundException({
            code: "RESOURCE_NOT_FOUND",
            message: "Resource was not found",
          });
        }
        const updated = await transaction.organization.update({
          where: { id },
          data: { status: value.status },
        });
        const userAgent = request.headers["user-agent"];
        await transaction.auditLog.create({
          data: {
            organizationId: id,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "organization.status.updated",
            entityType: "Organization",
            entityId: id,
            before: { status: current.status },
            after: { status: updated.status },
            correlationId: getCorrelationId(request),
            ipAddress: request.ip.slice(0, 64),
            ...(typeof userAgent === "string"
              ? { userAgent: userAgent.slice(0, 1_024) }
              : {}),
          },
        });
        return updated;
      },
    );
    return { data: organization };
  }
}
