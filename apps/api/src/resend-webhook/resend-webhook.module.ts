import { Module } from "@nestjs/common";

import { WebhookInboxModule } from "../webhook-inbox/webhook-inbox.module";
import { ResendWebhookController } from "./resend-webhook.controller";
import { ResendWebhookService } from "./resend-webhook.service";

@Module({
  imports: [WebhookInboxModule],
  controllers: [ResendWebhookController],
  providers: [ResendWebhookService],
})
export class ResendWebhookModule {}
