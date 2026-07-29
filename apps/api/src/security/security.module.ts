import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class SecurityModule {}
