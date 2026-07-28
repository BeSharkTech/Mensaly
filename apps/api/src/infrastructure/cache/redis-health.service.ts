import { Injectable } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisHealthService {
  async ping(): Promise<void> {
    const client = new Redis(process.env.REDIS_URL ?? "", {
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    try {
      await client.connect();
      const response = await client.ping();

      if (response !== "PONG") {
        throw new Error("Unexpected Redis ping response.");
      }
    } finally {
      client.disconnect();
    }
  }
}
