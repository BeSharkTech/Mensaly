import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
} from "@mensaly/config";

import { createApiApplication } from "./app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("OpenAPI contract tests require isolated test services.");
}

function environment() {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: "https://allowed.example",
  });
}

type Operation = {
  operationId?: string;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  summary?: string;
  tags?: string[];
};
type InjectMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

const bodyRequiredOperations = new Set([
  "PATCH /api/v1/admin/organizations/{id}/status",
  "POST /api/v1/plans",
  "PATCH /api/v1/plans/{id}",
  "POST /api/v1/students",
  "PATCH /api/v1/students/{id}",
  "POST /api/v1/students/{studentId}/guardians/{guardianId}",
  "POST /api/v1/guardians",
  "PATCH /api/v1/guardians/{id}",
  "POST /api/v1/enrollments",
  "PATCH /api/v1/enrollments/{id}",
]);

const publicOperations = new Set([
  "GET /api/v1/health/live",
  "GET /api/v1/health/ready",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/verify-email/request",
  "POST /api/v1/auth/verify-email/confirm",
  "POST /api/v1/auth/password-reset/request",
  "POST /api/v1/auth/password-reset/confirm",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
]);

describe("frozen OpenAPI v1 contract", () => {
  it("is complete, unique and byte-for-byte represented by the frozen JSON", async () => {
    const app = await createApiApplication(environment());
    try {
      await app.init();
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.equal(response.statusCode, 200);
      const live = response.json();
      const frozen = JSON.parse(
        await readFile(
          resolve(__dirname, "../../../docs/api/openapi.v1.json"),
          "utf8",
        ),
      );
      assert.deepEqual(live, frozen, "run pnpm api:openapi after API changes");
      assert.equal(live.openapi, "3.0.0");
      assert.equal(live.info.version, "1.0.0");
      assert.equal(
        live.components.securitySchemes.sessionCookie.name,
        "mensaly_session",
      );

      const operationIds = new Set<string>();
      let operationCount = 0;
      for (const [path, pathItem] of Object.entries(
        live.paths as Record<string, Record<string, Operation>>,
      )) {
        assert.match(path, /^\/api\/v1\//);
        for (const [method, operation] of Object.entries(pathItem)) {
          if (method === "parameters") {
            continue;
          }
          operationCount += 1;
          assert.ok(operation.summary?.trim(), `${method} ${path} summary`);
          assert.ok(operation.tags?.length, `${method} ${path} tags`);
          assert.ok(operation.responses, `${method} ${path} responses`);
          assert.ok(
            Object.keys(operation.responses ?? {}).some((status) =>
              /^2\d\d$/.test(status),
            ),
            `${method} ${path} success response`,
          );
          assert.ok(operation.operationId, `${method} ${path} operationId`);
          if (bodyRequiredOperations.has(`${method.toUpperCase()} ${path}`)) {
            assert.ok(operation.requestBody, `${method} ${path} request body`);
          }
          const operationKey = `${method.toUpperCase()} ${path}`;
          if (publicOperations.has(operationKey)) {
            assert.equal(
              operation.security,
              undefined,
              `${operationKey} must remain public`,
            );
          } else {
            assert.deepEqual(
              operation.security,
              [{ sessionCookie: [] }],
              `${operationKey} must declare session authentication`,
            );
            const protectedResponse = await app
              .getHttpAdapter()
              .getInstance()
              .inject({
                method: method.toUpperCase() as InjectMethod,
                url: path.replaceAll(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000001"),
                ...(operation.requestBody ? { payload: {} } : {}),
              });
            assert.equal(
              protectedResponse.statusCode,
              401,
              `${operationKey} must reject a missing session before input processing`,
            );
          }
          assert.equal(
            operationIds.has(operation.operationId ?? ""),
            false,
            `${method} ${path} duplicate operationId`,
          );
          operationIds.add(operation.operationId ?? "");
        }
      }
      assert.equal(operationCount, 74);
    } finally {
      await app.close();
    }
  });
});
