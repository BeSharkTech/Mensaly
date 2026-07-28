import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { RedisHealthService } from "./infrastructure/cache/redis-health.service";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { OrganizationModule } from "./organization/organization.module";
import { OperationalModule } from "./operational/operational.module";
import { FinancialModule } from "./financial/financial.module";
import { RemindersModule } from "./reminders/reminders.module";

@Module({
  imports: [DatabaseModule, AuthModule, OrganizationModule, AdminModule, OperationalModule, FinancialModule, RemindersModule],
  controllers: [HealthController],
  providers: [HealthService, RedisHealthService],
})
export class AppModule {}
