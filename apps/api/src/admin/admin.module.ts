import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [AdminController],
})
export class AdminModule {}
