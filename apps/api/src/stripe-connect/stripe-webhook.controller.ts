import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import type { FastifyRequest } from "fastify";

import { StripeWebhookService } from "./stripe-webhook.service";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

@ApiTags("Webhooks")
@Controller({ path: "webhooks/stripe", version: "1" })
export class StripeWebhookController {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(StripeWebhookService)
    private readonly stripeWebhook: StripeWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(
    @Req() request: RawBodyRequest,
    @Headers("stripe-signature") signature?: string,
  ) {
    if (!request.rawBody) {
      throw new ServiceUnavailableException({
        code: "STRIPE_WEBHOOK_RAW_BODY_UNAVAILABLE",
        message: "Webhook verification is temporarily unavailable",
      });
    }
    return this.stripeWebhook.receive({
      rawBody: request.rawBody,
      signature,
      webhookSecret: this.environment.STRIPE_WEBHOOK_SECRET,
    });
  }
}
