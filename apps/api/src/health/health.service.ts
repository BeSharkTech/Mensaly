import {
  Inject,
  ServiceUnavailableException,
  Injectable,
} from "@nestjs/common";

import { RedisHealthService } from "../infrastructure/cache/redis-health.service";
import { PrismaService } from "../infrastructure/database/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisHealthService) private readonly redis: RedisHealthService,
  ) {}

  live() {
    return { status: "ok" as const };
  }

  async ready() {
    const [database, redis] = await Promise.allSettled([
      this.prisma.client.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);
    const dependencies = {
      database: database.status === "fulfilled" ? "ready" : "unavailable",
      redis: redis.status === "fulfilled" ? "ready" : "unavailable",
    } as const;

    if (database.status === "rejected" || redis.status === "rejected") {
      throw new ServiceUnavailableException({
        code: "DEPENDENCIES_NOT_READY",
        message: "One or more required dependencies are unavailable",
        details: Object.entries(dependencies)
          .filter(([, status]) => status === "unavailable")
          .map(([field]) => ({ field, message: "unavailable" })),
      });
    }

    return { status: "ready" as const, dependencies };
  }
}
