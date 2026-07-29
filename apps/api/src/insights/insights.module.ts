import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AdminInsightsController } from "./admin-insights.controller";
import { AdminInsightsService } from "./admin-insights.service";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [DashboardController, AdminInsightsController],
  providers: [DashboardService, AdminInsightsService],
})
export class InsightsModule {}
