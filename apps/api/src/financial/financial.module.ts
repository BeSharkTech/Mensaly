import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FinancialController } from "./financial.controller";
import { FinancialService } from "./financial.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [FinancialController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
