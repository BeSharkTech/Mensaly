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

    await getPrismaClient().user.update({
      where: { email },
      data: { emailVerified: true, status: "ACTIVE" },
    });

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "runtime-registration-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);

    const session = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).data.email, email);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(logout.status, 204);
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
