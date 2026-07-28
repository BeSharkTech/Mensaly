const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiApplication } = require("../dist/app");
const {
  apiEnvironmentSchema,
  parseEnvironment,
} = require("@mensaly/config");
const { getPrismaClient } = require("@mensaly/database");
const { randomUUID } = require("node:crypto");

test("compiled API starts and serves its operational endpoints", async () => {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await createApiApplication(environment);
  const email = `runtime-registration-${randomUUID()}@api.example.test`;

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = await app.getUrl();
    const [live, ready, openApi, registration] = await Promise.all([
      fetch(`${baseUrl}/api/v1/health/live`),
      fetch(`${baseUrl}/api/v1/health/ready`),
      fetch(`${baseUrl}/api/docs-json`),
      fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Runtime registration",
          email,
          password: "runtime-registration-password",
        }),
      }),
    ]);

    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(openApi.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    assert.equal((await ready.json()).status, "ready");
    assert.equal((await openApi.json()).info.title, "Mensaly API");
    assert.equal(registration.status, 201);
    assert.equal((await registration.json()).data.email, email);
  } finally {
    await app.close();
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (user) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
});
