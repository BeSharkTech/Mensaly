import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
} from "@mensaly/config";
import { getPrismaClient } from "@mensaly/database";

import { createApiApplication } from "../app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const emails = new Set<string>();
const organizationIds = new Set<string>();
const storageRoot = join(tmpdir(), "mensaly-test-storage");

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("File tests require isolated test services.");
}

function environment() {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: "https://allowed.example",
  });
}

function cookieHeader(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(";")[0];
}

function multipartFile(input: {
  filename: string;
  contentType: string;
  body: Buffer;
}) {
  const boundary = `mensaly-${randomUUID()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.filename}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, input.body, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("local organization files", () => {
  it("validates, isolates, verifies and deletes local files", async () => {
    const app = await createApiApplication(environment());
    const password = "correct-horse-battery-staple";
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createAccount = async (label: string) => {
        const email = `files-${label}-${randomUUID()}@api.example.test`;
        emails.add(email);
        assert.equal(
          (
            await fastify.inject({
              method: "POST",
              url: "/api/v1/auth/register",
              payload: { name: `Files ${label}`, email, password },
            })
          ).statusCode,
          201,
        );
        const user = await getPrismaClient().user.update({
          where: { email },
          data: { emailVerified: true, status: "ACTIVE" },
        });
        const login = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        const cookie = cookieHeader(login.headers["set-cookie"]);
        assert.ok(cookie);
        const organization = await fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/organization",
          payload: {
            name: `Files ${label}`,
            taxId: `${label === "a" ? "51" : "52"}${randomUUID()
              .replace(/\D/g, "")
              .padEnd(9, "0")
              .slice(0, 9)}`,
            phone: "11999999999",
          },
        });
        assert.equal(organization.statusCode, 201);
        organizationIds.add(organization.json().data.id);
        return {
          cookie,
          organizationId: organization.json().data.id as string,
          userId: user.id,
        };
      };
      const accountA = await createAccount("a");
      const accountB = await createAccount("b");
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from("mensaly-image"),
      ]);
      const uploadBody = multipartFile({
        filename: "../../receipt.png",
        contentType: "image/png",
        body: png,
      });
      const uploaded = await fastify.inject({
        headers: { cookie: accountA.cookie, ...uploadBody.headers },
        method: "POST",
        url: "/api/v1/files",
        payload: uploadBody.payload,
      });
      assert.equal(uploaded.statusCode, 201);
      assert.equal(uploaded.json().data.originalName, "receipt.png");
      assert.equal(uploaded.json().data.status, "ACTIVE");
      const fileId = uploaded.json().data.id as string;

      const invalid = multipartFile({
        filename: "fake.pdf",
        contentType: "application/pdf",
        body: Buffer.from("not a pdf"),
      });
      const invalidUpload = await fastify.inject({
        headers: { cookie: accountA.cookie, ...invalid.headers },
        method: "POST",
        url: "/api/v1/files",
        payload: invalid.payload,
      });
      assert.equal(invalidUpload.statusCode, 400);
      assert.equal(invalidUpload.json().error.code, "INVALID_FILE_TYPE");

      const listA = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/files",
      });
      assert.equal(listA.statusCode, 200);
      assert.equal(listA.json().meta.total, 1);
      const listB = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "GET",
        url: "/api/v1/files",
      });
      assert.equal(listB.json().meta.total, 0);
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountB.cookie },
            method: "GET",
            url: `/api/v1/files/${fileId}`,
          })
        ).statusCode,
        404,
      );

      const download = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/files/${fileId}/content`,
      });
      assert.equal(download.statusCode, 200);
      assert.equal(download.headers["content-type"], "image/png");
      assert.deepEqual(download.rawPayload, png);

      const metadata = await getPrismaClient().storedFile.findUniqueOrThrow({
        where: { id: fileId },
      });
      const physicalPath = join(storageRoot, ...metadata.storageKey.split("/"));
      await writeFile(physicalPath, Buffer.from("tampered"));
      const corrupt = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/files/${fileId}/content`,
      });
      assert.equal(corrupt.statusCode, 503);
      assert.equal(corrupt.json().error.code, "FILE_STORAGE_CORRUPT");
      await writeFile(physicalPath, png);

      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "DELETE",
            url: `/api/v1/files/${fileId}`,
          })
        ).statusCode,
        204,
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "DELETE",
            url: `/api/v1/files/${fileId}`,
          })
        ).statusCode,
        204,
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "GET",
            url: `/api/v1/files/${fileId}`,
          })
        ).statusCode,
        404,
      );

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.equal(
        openApi.json().paths["/api/v1/files"].post.requestBody.content[
          "multipart/form-data"
        ].schema.properties.file.format,
        "binary",
      );

      const failedId = randomUUID();
      await getPrismaClient().storedFile.create({
        data: {
          id: failedId,
          organizationId: accountA.organizationId,
          uploadedByUserId: accountA.userId,
          storageKey: `${accountA.organizationId}/${failedId}`,
          originalName: "failed.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
          checksumSha256: "0".repeat(64),
          status: "FAILED",
        },
      });
      const otherCleanup = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "POST",
        url: "/api/v1/files/cleanup",
      });
      assert.deepEqual(otherCleanup.json().data, { examined: 0, cleaned: 0 });
      const cleanup = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/files/cleanup",
      });
      assert.deepEqual(cleanup.json().data, { examined: 1, cleaned: 1 });
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  const organizations = [...organizationIds];
  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { organizationId: { in: organizations } },
        { actorUserId: { in: userIds } },
      ],
    },
  });
  await prisma.storedFile.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verification.deleteMany({
    where: { identifier: { in: [...emails] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizations } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await rm(storageRoot, { recursive: true, force: true });
});
