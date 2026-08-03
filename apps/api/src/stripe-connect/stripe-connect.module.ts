import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { WebhookInboxModule } from "../webhook-inbox/webhook-inbox.module";
import { StripeCheckoutController, StripePublicCheckoutController } from "./stripe-checkout.controller";
import { StripeCheckoutService } from "./stripe-checkout.service";
import { StripeConnectController } from "./stripe-connect.controller";
import { createStripeGateway, STRIPE_GATEWAY } from "./stripe-connect.gateway";
import { StripeConnectService } from "./stripe-connect.service";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { StripeWebhookService } from "./stripe-webhook.service";

@Module({
  imports: [AuthModule, AuthorizationModule, WebhookInboxModule],
  controllers: [
    StripeConnectController,
    StripeCheckoutController,
    StripePublicCheckoutController,
    StripeWebhookController,
  ],
  providers: [
    { provide: STRIPE_GATEWAY, useFactory: createStripeGateway },
    StripeConnectService,
    StripeCheckoutService,
    StripeWebhookService,
  ],
  exports: [StripeConnectService, StripeCheckoutService],
})
export class StripeConnectModule {}
