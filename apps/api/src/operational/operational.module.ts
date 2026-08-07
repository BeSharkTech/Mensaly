import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FinancialModule } from "../financial/financial.module";
import { OperationalController } from "./operational.controller";
import { OperationalService } from "./operational.service";

@Module({
  imports: [AuthModule, AuthorizationModule, FinancialModule],
  controllers: [OperationalController],
  providers: [OperationalService],
})
export class OperationalModule {}
