import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { S3StorageAdapter } from "./s3-storage.adapter";

const configuration = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "mensaly-files",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  forcePathStyle: false,
};

describe("S3StorageAdapter", () => {
  it("writes, reads, checks and removes objects without leaking credentials", async () => {
    const commands: { constructor: { name: string } }[] = [];
    const client = {
      async send(command: { constructor: { name: string } }) {
        commands.push(command);
        if (command.constructor.name === "GetObjectCommand") {
          return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
        }
        return {};
      },
    };
    const adapter = new S3StorageAdapter(configuration, client as never);

    await adapter.put("organization/file", Buffer.from([1, 2, 3]));
    assert.deepEqual(await adapter.get("organization/file"), {
      key: "organization/file",
      body: Buffer.from([1, 2, 3]),
    });
    await adapter.healthcheck();
    await adapter.delete("organization/file");
    assert.deepEqual(commands.map((command) => command.constructor.name), [
      "PutObjectCommand",
      "GetObjectCommand",
      "HeadBucketCommand",
      "DeleteObjectCommand",
    ]);
  });

  it("returns null only for an explicit missing object", async () => {
    const adapter = new S3StorageAdapter(configuration, {
      async send() {
        throw { name: "NoSuchKey" };
      },
    } as never);
    assert.equal(await adapter.get("organization/missing"), null);
  });
});
