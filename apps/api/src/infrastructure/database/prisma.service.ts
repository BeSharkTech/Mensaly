import {
  disconnectPrismaClient,
  getPrismaClient,
  type PrismaClient,
} from "@mensaly/database";
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  readonly client: PrismaClient = getPrismaClient();
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
    } catch {
      this.logger.warn(
        "PostgreSQL is unavailable during startup; readiness will remain false.",
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await disconnectPrismaClient();
  }
}
