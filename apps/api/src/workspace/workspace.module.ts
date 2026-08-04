import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PublicFormsController, WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [WorkspaceController, PublicFormsController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
