import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { ReminderConfigurationController } from "./reminder-configuration.controller";
import { ReminderConfigurationService } from "./reminder-configuration.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ReminderConfigurationController],
  providers: [ReminderConfigurationService],
})
export class RemindersModule {}
