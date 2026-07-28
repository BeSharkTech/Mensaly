import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { PlatformAdminGuard, SessionAuthGuard } from "../authorization/authorization.guards";

@ApiTags("Platform administration")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class AdminController {
  @Get("session")
  @ApiOkResponse({ description: "Authenticated platform administrator session without organization context" })
  @ApiUnauthorizedResponse({ description: "A valid platform administrator session is required" })
  session(@CurrentAuth() auth: AuthenticatedContext): { data: unknown } {
    return { data: { id: auth.userId, email: auth.email, role: auth.role, organizationId: auth.organizationId ?? null } };
  }
}
