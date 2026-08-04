import { Body, Controller, Headers, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";

import { MercadoPagoWebhookService } from "./mercadopago-webhook.service";

@ApiTags("Webhooks")
@Controller({ path: "webhooks/mercadopago", version: "1" })
export class MercadoPagoWebhookController {
  constructor(
    @Inject(MercadoPagoWebhookService)
    private readonly webhook: MercadoPagoWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query("data.id") dataId: string | undefined,
    @Body() body: unknown,
  ) {
    return this.webhook.receive({ body, signature, requestId, dataId });
  }
}
