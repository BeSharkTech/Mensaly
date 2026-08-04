import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LocalEmailDeliveryService } from "./local-email-delivery.service";
import { EmailDeliveryService } from "./email-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, LocalEmailDeliveryService, EmailDeliveryService],
  exports: [AuthService],
})
export class AuthModule {}
