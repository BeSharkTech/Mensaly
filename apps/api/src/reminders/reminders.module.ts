import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { MessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { ReminderConfigurationController } from "./reminder-configuration.controller";
import { ReminderConfigurationService } from "./reminder-configuration.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ReminderConfigurationController, MessagingController],
  providers: [ReminderConfigurationService, MessagingService],
})
export class RemindersModule {}
