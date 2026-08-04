import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { MercadoPagoCheckoutService } from "./mercadopago-checkout.service";
import { mercadoPagoBrickSubmissionSchema, mercadoPagoCheckoutTokenSchema } from "./mercadopago.dto";

function requestMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

@ApiTags("Mercado Pago Checkout")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "charges", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class MercadoPagoCheckoutController {
  constructor(@Inject(MercadoPagoCheckoutService) private readonly checkout: MercadoPagoCheckoutService) {}

  @Post(":id/mercadopago-checkout-link")
  @HttpCode(200)
  @ApiOperation({ summary: "Creates or reuses a Mercado Pago payment link" })
  async createLink(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) chargeId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.checkout.createPaymentLink(auth, chargeId, requestMetadata(request)) };
  }
}

@ApiTags("Public Mercado Pago Checkout")
@Controller({ path: "public/mercadopago-checkout", version: "1" })
export class MercadoPagoPublicCheckoutController {
  constructor(@Inject(MercadoPagoCheckoutService) private readonly checkout: MercadoPagoCheckoutService) {}

  @Get(":token")
  @ApiOperation({ summary: "Gets a public Mercado Pago checkout" })
  async details(@Param("token") rawToken: string): Promise<{ data: unknown }> {
    return { data: await this.checkout.publicDetails(mercadoPagoCheckoutTokenSchema.parse(rawToken)) };
  }

  @Post(":token/process")
  @HttpCode(200)
  @ApiOperation({ summary: "Submits a tokenized Mercado Pago payment" })
  async process(@Param("token") rawToken: string, @Body() rawBody: unknown): Promise<{ data: unknown }> {
    return {
      data: await this.checkout.processPayment(
        mercadoPagoCheckoutTokenSchema.parse(rawToken),
        mercadoPagoBrickSubmissionSchema.parse(rawBody),
      ),
    };
  }

  @Post(":token/reconcile")
  @HttpCode(200)
  @ApiOperation({ summary: "Reconciles a checkout with Mercado Pago" })
  async reconcile(@Param("token") rawToken: string): Promise<{ data: unknown }> {
    return { data: await this.checkout.reconcile(mercadoPagoCheckoutTokenSchema.parse(rawToken)) };
  }
}
