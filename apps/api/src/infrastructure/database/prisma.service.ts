import {
  disconnectPrismaClient,
  getPrismaClient,
  type PrismaClient,
} from "@mensaly/database";
import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  readonly client: PrismaClient = getPrismaClient();

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await disconnectPrismaClient();
  }
}
