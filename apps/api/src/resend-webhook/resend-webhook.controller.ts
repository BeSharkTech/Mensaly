import {
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { getCorrelationId } from "../common/correlation";
import { ResendWebhookService } from "./resend-webhook.service";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

@ApiTags("Webhooks")
@Controller({ path: "webhooks/resend", version: "1" })
export class ResendWebhookController {
  constructor(
    @Inject(ResendWebhookService)
    private readonly resendWebhook: ResendWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(@Req() request: RawBodyRequest) {
    if (!request.rawBody) {
      throw new ServiceUnavailableException({
        code: "RESEND_WEBHOOK_RAW_BODY_UNAVAILABLE",
        message: "Webhook verification is temporarily unavailable",
      });
    }
    return this.resendWebhook.receive({
      rawBody: request.rawBody.toString("utf8"),
      headers: request.headers,
      correlationId: getCorrelationId(request),
    });
  }
}
