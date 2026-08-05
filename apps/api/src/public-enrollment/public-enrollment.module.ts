import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FilesModule } from "../files/files.module";
import {
  PublicEnrollmentController,
  PublicEnrollmentFormController,
} from "./public-enrollment.controller";
import { PublicEnrollmentService } from "./public-enrollment.service";

@Module({
  imports: [AuthModule, AuthorizationModule, FilesModule],
  controllers: [PublicEnrollmentFormController, PublicEnrollmentController],
  providers: [PublicEnrollmentService],
  exports: [PublicEnrollmentService],
})
export class PublicEnrollmentModule {}
