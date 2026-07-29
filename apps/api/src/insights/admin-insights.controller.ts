import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import {
  PlatformAdminGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminInsightsService } from "./admin-insights.service";
import {
  adminFailuresSchema,
  adminHistorySchema,
  adminOrganizationListSchema,
} from "./insights.dto";

@ApiTags("Platform administration")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class AdminInsightsController {
  constructor(
    @Inject(AdminInsightsService)
    private readonly insights: AdminInsightsService,
  ) {}

  @Get("overview")
  @ApiOperation({ summary: "Gets platform-wide totals and internal usage" })
  @ApiOkResponse({ description: "Platform overview" })
  async overview(): Promise<{ data: unknown }> {
    return { data: await this.insights.overview() };
  }

  @Get("organizations")
  @ApiOperation({ summary: "Lists organizations with consumption totals" })
  @ApiOkResponse({ description: "Paginated organization administration" })
  async organizations(
    @Query(new ZodValidationPipe(adminOrganizationListSchema))
    query: z.infer<typeof adminOrganizationListSchema>,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.insights.organizations(query);
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

  @Get("organizations/:id/history")
  @ApiOperation({ summary: "Gets one organization's administrative history" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Paginated audit history" })
  async history(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(adminHistorySchema))
    query: z.infer<typeof adminHistorySchema>,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.insights.history(id, query);
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

  @Get("failures")
  @ApiOperation({ summary: "Gets message and webhook failures" })
  @ApiOkResponse({ description: "Recent operational failures" })
  async failures(
    @Query(new ZodValidationPipe(adminFailuresSchema))
    query: z.infer<typeof adminFailuresSchema>,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.insights.failures(query),
    };
  }
}
