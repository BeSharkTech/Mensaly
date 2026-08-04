import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { checkoutTokenSchema } from "./stripe-connect.dto";
import { StripeCheckoutService } from "./stripe-checkout.service";

function requestMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

@ApiTags("Stripe Checkout")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "charges", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class StripeCheckoutController {
  constructor(
    @Inject(StripeCheckoutService)
    private readonly checkout: StripeCheckoutService,
  ) {}

  @Post(":id/checkout-link")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates or reuses the charge's public checkout link" })
  async createLink(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) chargeId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.checkout.createPaymentLink(
        auth,
        chargeId,
        requestMetadata(request),
      ),
    };
  }
}

@ApiTags("Public Stripe Checkout")
@Controller({ path: "public/checkout", version: "1" })
export class StripePublicCheckoutController {
  constructor(
    @Inject(StripeCheckoutService)
    private readonly checkout: StripeCheckoutService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "Gets safe public charge details" })
  async details(@Param("token") rawToken: string): Promise<{ data: unknown }> {
    const token = checkoutTokenSchema.parse(rawToken);
    return { data: await this.checkout.publicDetails(token) };
  }

  @Post(":token/session")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates or reuses an embedded Stripe Checkout Session" })
  async session(@Param("token") rawToken: string): Promise<{ data: unknown }> {
    const token = checkoutTokenSchema.parse(rawToken);
    return { data: await this.checkout.createOrReuseSession(token) };
  }

  @Post(":token/reconcile")
  @HttpCode(200)
  @ApiOperation({ summary: "Reconciles a checkout against Stripe after provider return" })
  async reconcile(@Param("token") rawToken: string): Promise<{ data: unknown }> {
    const token = checkoutTokenSchema.parse(rawToken);
    return { data: await this.checkout.reconcilePublicCheckout(token) };
  }
}
