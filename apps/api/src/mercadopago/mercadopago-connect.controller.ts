import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { MercadoPagoConnectService } from "./mercadopago-connect.service";
import { mercadoPagoOAuthCallbackSchema } from "./mercadopago.dto";

function requestMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

@ApiTags("Mercado Pago")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "payment-integrations/mercadopago", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class MercadoPagoConnectController {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(MercadoPagoConnectService)
    private readonly mercadoPago: MercadoPagoConnectService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Gets the authenticated organization's Mercado Pago status" })
  async status(@CurrentAuth() auth: AuthenticatedContext): Promise<{ data: unknown }> {
    return { data: await this.mercadoPago.getStatus(auth) };
  }

  @Post("authorize")
  @HttpCode(200)
  @ApiOperation({ summary: "Starts the Mercado Pago OAuth authorization" })
  async authorize(@CurrentAuth() auth: AuthenticatedContext, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    return { data: await this.mercadoPago.createAuthorization(auth, requestMetadata(request)) };
  }

  @Get("callback")
  @ApiExcludeEndpoint()
  async callback(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const query = mercadoPagoOAuthCallbackSchema.parse(rawQuery);
    await this.mercadoPago.completeAuthorization(auth, query, requestMetadata(request));
    const target = new URL("/onboarding", this.environment.WEB_APP_URL);
    target.searchParams.set("step", "payments");
    target.searchParams.set("mercadopago", "connected");
    return reply.redirect(target.toString());
  }

  @Post("disconnect")
  @HttpCode(200)
  @ApiOperation({ summary: "Disconnects the organization's Mercado Pago account" })
  async disconnect(@CurrentAuth() auth: AuthenticatedContext, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    return { data: await this.mercadoPago.disconnect(auth, requestMetadata(request)) };
  }
}
