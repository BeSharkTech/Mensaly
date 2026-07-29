import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { WebhookInboxController } from "./webhook-inbox.controller";
import { WebhookInboxService } from "./webhook-inbox.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [WebhookInboxController],
  providers: [WebhookInboxService],
  exports: [WebhookInboxService],
})
export class WebhookInboxModule {}
