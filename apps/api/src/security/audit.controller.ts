import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { type AuditList, auditListSchema } from "./audit.dto";
import { AuditService } from "./audit.service";

@ApiTags("Audit")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "audit-logs", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class AuditController {
  constructor(
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Lists the current organization's audit trail" })
  @ApiOkResponse({ description: "Immutable and paginated audit records" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(auditListSchema)) query: AuditList,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.auditService.list(auth, query);
    return {
      data: result.items,
      meta: {
        page: result.page,
        limit: result.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / result.pageSize),
      },
    };
  }
}
