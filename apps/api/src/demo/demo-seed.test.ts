import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateDemoSeedEnvironment } from "./demo-seed";

describe("controlled demo seed", () => {
  it("requires explicit opt-in, a local database and a strong password", () => {
    assert.throws(() => validateDemoSeedEnvironment({}), /disabled/);
    assert.throws(
      () =>
        validateDemoSeedEnvironment({
          DEMO_SEED_ENABLED: "true",
          DEMO_SEED_PASSWORD: "long-enough-password",
          DATABASE_URL: "postgresql://user:pass@db.example/prod",
        }),
      /local database/,
    );
    assert.throws(
      () =>
        validateDemoSeedEnvironment({
          DEMO_SEED_ENABLED: "true",
          DEMO_SEED_PASSWORD: "long-enough-password",
          DATABASE_URL: "postgresql://user:pass@localhost/dev",
          NODE_ENV: "production",
        }),
      /forbidden/,
    );
    assert.deepEqual(
      validateDemoSeedEnvironment({
        DEMO_SEED_ENABLED: "true",
        DEMO_SEED_PASSWORD: "long-enough-password",
        DATABASE_URL: "postgresql://user:pass@localhost/dev",
      }),
      {
        email: "owner.demo@mensaly.local",
        password: "long-enough-password",
      },
    );
  });
});
