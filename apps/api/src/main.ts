import "reflect-metadata";
import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";

async function bootstrap() {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen({ host: "0.0.0.0", port: environment.API_PORT });
}

void bootstrap();
