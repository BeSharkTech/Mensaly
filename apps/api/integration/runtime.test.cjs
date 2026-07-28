const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiApplication } = require("../dist/app");
const {
  apiEnvironmentSchema,
  parseEnvironment,
} = require("@mensaly/config");

test("compiled API starts and serves its operational endpoints", async () => {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await createApiApplication(environment);

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = await app.getUrl();
    const [live, ready, openApi] = await Promise.all([
      fetch(`${baseUrl}/api/v1/health/live`),
      fetch(`${baseUrl}/api/v1/health/ready`),
      fetch(`${baseUrl}/api/docs-json`),
    ]);

    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(openApi.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    assert.equal((await ready.json()).status, "ready");
    assert.equal((await openApi.json()).info.title, "Mensaly API");
  } finally {
    await app.close();
  }
});
