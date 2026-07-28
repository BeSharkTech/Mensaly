import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, UseGuards } from "@nestjs/common";
import { AuditActorType, OrganizationStatus } from "@mensaly/database";
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { PlatformAdminGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { OrganizationStatusDto } from "./organization-status.dto";

@ApiTags("Platform administration")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get("session")
  @ApiOkResponse({ description: "Authenticated platform administrator session without organization context" })
  @ApiUnauthorizedResponse({ description: "A valid platform administrator session is required" })
  session(@CurrentAuth() auth: AuthenticatedContext): { data: unknown } {
    return { data: { id: auth.userId, email: auth.email, role: auth.role, organizationId: auth.organizationId ?? null } };
  }

  @Patch("organizations/:id/status")
  async updateOrganizationStatus(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string, @Body() input: OrganizationStatusDto): Promise<{ data: unknown }> {
    const value = input as unknown as { status: OrganizationStatus };
    const current = await this.prisma.client.organization.findUnique({ where: { id } });
    if (!current) throw new NotFoundException({ code: "RESOURCE_NOT_FOUND", message: "Resource was not found" });
    const organization = await this.prisma.client.organization.update({ where: { id }, data: { status: value.status } });
    await this.prisma.client.auditLog.create({ data: { organizationId: id, actorUserId: auth.userId, actorType: AuditActorType.USER, action: "organization.status.updated", entityType: "Organization", entityId: id, before: { status: current.status }, after: { status: organization.status } } });
    return { data: organization };
  }
}
