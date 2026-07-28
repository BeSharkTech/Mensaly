import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LocalEmailDeliveryService } from "./local-email-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, LocalEmailDeliveryService],
  exports: [AuthService],
})
export class AuthModule {}
