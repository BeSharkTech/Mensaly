import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [OrganizationController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
