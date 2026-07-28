import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
  workerEnvironmentSchema,
} from "./index";

const validConnections = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/mensaly",
  REDIS_URL: "redis://localhost:6379",
};

describe("environment configuration", () => {
  it("parses valid API values and applies defaults", () => {
    const environment = parseEnvironment(
      apiEnvironmentSchema,
      validConnections,
    );

    assert.equal(environment.NODE_ENV, "development");
    assert.equal(environment.API_PORT, 3001);
    assert.equal(environment.DATABASE_URL, validConnections.DATABASE_URL);
    assert.equal(environment.REDIS_URL, validConnections.REDIS_URL);
    assert.deepEqual(environment.CORS_ORIGINS, ["http://localhost:3000"]);
  });

  it("parses an explicit CORS allowlist", () => {
    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      CORS_ORIGINS: "https://app.mensaly.com, https://admin.mensaly.com",
    });

    assert.deepEqual(environment.CORS_ORIGINS, [
      "https://app.mensaly.com",
      "https://admin.mensaly.com",
    ]);
  });

  it("refuses wildcard or empty CORS origins in production", () => {
    for (const CORS_ORIGINS of ["*", "", undefined]) {
      assert.throws(
        () =>
          parseEnvironment(apiEnvironmentSchema, {
            ...validConnections,
            NODE_ENV: "production",
            CORS_ORIGINS,
          }),
        /production requires at least one explicit origin/,
      );
    }
  });

  it("coerces a valid API port", () => {
    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      NODE_ENV: "test",
      API_PORT: "4000",
    });

    assert.equal(environment.NODE_ENV, "test");
    assert.equal(environment.API_PORT, 4000);
  });

  it("reports every missing worker variable", () => {
    assert.throws(
      () => parseEnvironment(workerEnvironmentSchema, {}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.match(error.message, /REDIS_URL/);
        return true;
      },
    );
  });

  it("rejects incorrect connection protocols", () => {
    assert.throws(
      () =>
        parseEnvironment(workerEnvironmentSchema, {
          DATABASE_URL: "https://database.example",
          REDIS_URL: "https://redis.example",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /postgres/);
        assert.match(error.message, /redis/);
        return true;
      },
    );
  });
});
