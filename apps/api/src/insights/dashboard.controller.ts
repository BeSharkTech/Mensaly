import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DashboardService } from "./dashboard.service";
import {
  dashboardAsOfSchema,
  evolutionSchema,
  limitSchema,
  upcomingDueSchema,
} from "./insights.dto";

@ApiTags("Dashboard")
@Controller({ path: "dashboard", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class DashboardController {
  constructor(
    @Inject(DashboardService)
    private readonly dashboard: DashboardService,
  ) {}

  @Get("overview")
  @ApiOperation({ summary: "Gets organization financial and student totals" })
  @ApiOkResponse({ description: "Dashboard overview" })
  async overview(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(dashboardAsOfSchema))
    query: z.infer<typeof dashboardAsOfSchema>,
  ): Promise<{ data: unknown }> {
    return { data: await this.dashboard.overview(auth, query.asOf) };
  }

  @Get("upcoming-due")
  @ApiOperation({ summary: "Lists upcoming pending charges" })
  @ApiOkResponse({ description: "Upcoming charges with student and guardian" })
  async upcoming(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(upcomingDueSchema))
    query: z.infer<typeof upcomingDueSchema>,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.dashboard.upcoming(auth, query) };
  }

  @Get("recent-payments")
  @ApiOperation({ summary: "Lists the latest confirmed payments" })
  @ApiOkResponse({ description: "Recent payments" })
  async recentPayments(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(limitSchema))
    query: z.infer<typeof limitSchema>,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.dashboard.recentPayments(auth, query.limit) };
  }

  @Get("message-failures")
  @ApiOperation({ summary: "Lists recent message delivery failures" })
  @ApiOkResponse({ description: "Message failures without cross-tenant data" })
  async messageFailures(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(limitSchema))
    query: z.infer<typeof limitSchema>,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.dashboard.messageFailures(auth, query.limit) };
  }

  @Get("monthly-evolution")
  @ApiOperation({ summary: "Gets monthly financial evolution" })
  @ApiOkResponse({ description: "Continuous monthly time series" })
  async evolution(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(evolutionSchema))
    query: z.infer<typeof evolutionSchema>,
  ): Promise<{ data: unknown[] }> {
    return {
      data: await this.dashboard.evolution(auth, query),
    };
  }
}
