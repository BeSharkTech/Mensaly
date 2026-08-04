import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { WebhookInboxModule } from "../webhook-inbox/webhook-inbox.module";
import { MercadoPagoCheckoutController, MercadoPagoPublicCheckoutController } from "./mercadopago-checkout.controller";
import { MercadoPagoCheckoutService } from "./mercadopago-checkout.service";
import { MercadoPagoConnectController } from "./mercadopago-connect.controller";
import { MercadoPagoConnectService } from "./mercadopago-connect.service";
import { createMercadoPagoGateway, MERCADOPAGO_GATEWAY } from "./mercadopago.gateway";
import { MercadoPagoWebhookController } from "./mercadopago-webhook.controller";
import { MercadoPagoWebhookService } from "./mercadopago-webhook.service";

@Module({
  imports: [AuthModule, AuthorizationModule, WebhookInboxModule],
  controllers: [
    MercadoPagoConnectController,
    MercadoPagoCheckoutController,
    MercadoPagoPublicCheckoutController,
    MercadoPagoWebhookController,
  ],
  providers: [
    { provide: MERCADOPAGO_GATEWAY, useFactory: createMercadoPagoGateway },
    MercadoPagoConnectService,
    MercadoPagoCheckoutService,
    MercadoPagoWebhookService,
  ],
  exports: [MercadoPagoConnectService, MercadoPagoCheckoutService],
})
export class MercadoPagoModule {}
