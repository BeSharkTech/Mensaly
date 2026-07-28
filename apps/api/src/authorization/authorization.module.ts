import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CompanyAccountGuard, PlatformAdminGuard, SessionAuthGuard } from "./authorization.guards";

@Module({
  imports: [AuthModule],
  providers: [SessionAuthGuard, CompanyAccountGuard, PlatformAdminGuard],
  exports: [SessionAuthGuard, CompanyAccountGuard, PlatformAdminGuard],
})
export class AuthorizationModule {}
