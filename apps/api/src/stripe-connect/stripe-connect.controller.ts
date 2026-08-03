import { Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { StripeConnectService } from "./stripe-connect.service";

function requestMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

@ApiTags("Stripe Connect")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "payment-integrations/stripe", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class StripeConnectController {
  constructor(
    @Inject(StripeConnectService)
    private readonly stripeConnect: StripeConnectService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Gets the authenticated organization's Stripe status" })
  @ApiOkResponse({ description: "Stripe connection status" })
  async status(@CurrentAuth() auth: AuthenticatedContext): Promise<{ data: unknown }> {
    return { data: await this.stripeConnect.getStatus(auth) };
  }

  @Post("account")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates or reuses the organization's connected account" })
  async account(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.stripeConnect.ensureAccount(auth, requestMetadata(request)),
    };
  }

  @Post("reconnect")
  @HttpCode(200)
  @ApiOperation({ summary: "Safely migrates an empty legacy connection to Stripe Express" })
  async reconnect(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.stripeConnect.reconnectAsExpress(auth, requestMetadata(request)),
    };
  }

  @Post("onboarding-link")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates a short-lived Stripe onboarding link" })
  async onboardingLink(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.stripeConnect.createOnboardingLink(
        auth,
        requestMetadata(request),
      ),
    };
  }

  @Post("onboarding-session")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates a short-lived embedded Stripe onboarding session" })
  async onboardingSession(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.stripeConnect.createEmbeddedOnboardingSession(
        auth,
        requestMetadata(request),
      ),
    };
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Refreshes the connected account status from Stripe" })
  async refresh(@CurrentAuth() auth: AuthenticatedContext): Promise<{ data: unknown }> {
    return { data: await this.stripeConnect.refreshAuthenticatedAccount(auth) };
  }
}
