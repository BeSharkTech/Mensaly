import { Module } from "@nestjs/common";

import { DatabaseModule } from "./infrastructure/database/database.module";
import { RedisHealthService } from "./infrastructure/cache/redis-health.service";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService, RedisHealthService],
})
export class AppModule {}
