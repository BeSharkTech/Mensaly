import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { RedisHealthService } from "./infrastructure/cache/redis-health.service";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { OrganizationModule } from "./organization/organization.module";

@Module({
  imports: [DatabaseModule, AuthModule, OrganizationModule],
  controllers: [HealthController],
  providers: [HealthService, RedisHealthService],
})
export class AppModule {}
