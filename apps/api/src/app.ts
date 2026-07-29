import "reflect-metadata";
import multipart from "@fastify/multipart";
import {
  apiEnvironmentSchema,
  parseEnvironment,
  type ApiEnvironment,
} from "@mensaly/config";
import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/global-exception.filter";
import { registerRequestContext } from "./common/correlation";
import { StructuredNestLogger } from "./common/structured-nest-logger";
import { ZodValidationPipe } from "./common/zod-validation.pipe";
import { configureFiles } from "./files/files.configuration";

function configureCors(
  app: NestFastifyApplication,
  environment: ApiEnvironment,
): void {
  app.enableCors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      const allowed =
        !origin ||
        environment.CORS_ORIGINS.includes("*") ||
        environment.CORS_ORIGINS.includes(origin);
      callback(null, allowed);
    },
  });
}

function configureOpenApi(app: NestFastifyApplication): void {
  const configuration = new DocumentBuilder()
    .setTitle("Mensaly API")
    .setDescription("Backend HTTP API for Mensaly")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, configuration);

  app.getHttpAdapter().get("/api/docs-json", (_request, reply) => {
    reply.send(document);
  });
}

export async function createApiApplication(
  environment: ApiEnvironment = parseEnvironment(
    apiEnvironmentSchema,
    process.env,
  ),
): Promise<NestFastifyApplication> {
  configureFiles(environment);
  const adapter = new FastifyAdapter({
    bodyLimit: Math.max(1_048_576, environment.FILE_MAX_SIZE_BYTES + 65_536),
    trustProxy: false,
  });
  await adapter.getInstance().register(multipart, {
    limits: {
      fileSize: environment.FILE_MAX_SIZE_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
    },
  });
  registerRequestContext(adapter.getInstance());

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      logger: new StructuredNestLogger(),
    },
  );

  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());
  configureCors(app, environment);
  configureOpenApi(app);

  return app;
}
