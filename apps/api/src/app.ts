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
import { registerApiSecurity } from "./common/api-security";
import { GlobalExceptionFilter } from "./common/global-exception.filter";
import { registerRequestContext } from "./common/correlation";
import { registerLocalRateLimit } from "./common/local-rate-limit";
import { configureObservability } from "./common/observability";
import { StructuredNestLogger } from "./common/structured-nest-logger";
import { ZodValidationPipe } from "./common/zod-validation.pipe";
import { configureFiles } from "./files/files.configuration";
import { configureAdminInsights } from "./insights/admin-insights.configuration";

function configureCors(
  app: NestFastifyApplication,
  environment: ApiEnvironment,
): void {
  const localDevelopmentOrigins = new Set([
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const isAllowedOrigin = (origin: string | undefined) =>
    !origin ||
    environment.CORS_ORIGINS.includes("*") ||
    environment.CORS_ORIGINS.includes(origin) ||
    (environment.NODE_ENV !== "production" && localDevelopmentOrigins.has(origin));

  // Register these headers before authentication guards can return a 401.
  // Without this, a valid unauthenticated session check is reported by the
  // browser as a generic "Failed to fetch" instead of a normal 401 response.
  app.getHttpAdapter().getInstance().addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    if (isAllowedOrigin(origin) && origin) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }
    if (request.method === "OPTIONS" && origin && isAllowedOrigin(origin)) {
      void reply
        .status(204)
        .header("access-control-allow-methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS")
        .header("access-control-allow-headers", "content-type,idempotency-key,x-correlation-id")
        .send();
      return;
    }
    done();
  });
  app.enableCors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  });
}

function configureOpenApi(app: NestFastifyApplication): void {
  const configuration = new DocumentBuilder()
    .setTitle("Mensaly API")
    .setDescription(
      "Versioned backend API for Mensaly company owners and platform administrators",
    )
    .setVersion("1.0.0")
    .addCookieAuth(
      "mensaly_session",
      { type: "apiKey", in: "cookie" },
      "sessionCookie",
    )
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
  configureObservability(environment);
  configureFiles(environment);
  configureAdminInsights(environment);
  const adapter = new FastifyAdapter({
    bodyLimit: Math.max(1_048_576, environment.FILE_MAX_SIZE_BYTES + 65_536),
    trustProxy:
      environment.TRUST_PROXY_HOPS > 0
        ? environment.TRUST_PROXY_HOPS
        : false,
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
  registerApiSecurity(adapter.getInstance(), environment.CORS_ORIGINS);
  registerLocalRateLimit(adapter.getInstance());

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      logger: new StructuredNestLogger(),
      rawBody: true,
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
