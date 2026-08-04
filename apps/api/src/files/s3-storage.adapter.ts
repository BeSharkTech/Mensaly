import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { StorageAdapter, StoredObject } from "./storage.adapter";

type S3ClientLike = Pick<S3Client, "send">;

export type S3StorageConfiguration = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3ClientLike;

  constructor(
    private readonly configuration: S3StorageConfiguration,
    client?: S3ClientLike,
  ) {
    this.client = client ?? new S3Client({
      endpoint: configuration.endpoint,
      region: configuration.region,
      forcePathStyle: configuration.forcePathStyle,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.configuration.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
      );
      if (!response.Body) {
        return null;
      }
      return {
        key,
        body: Buffer.from(await response.Body.transformToByteArray()),
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (("name" in error && error.name === "NoSuchKey") ||
          ("$metadata" in error &&
            typeof error.$metadata === "object" &&
            error.$metadata !== null &&
            "httpStatusCode" in error.$metadata &&
            error.$metadata.httpStatusCode === 404))
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
    );
  }

  async healthcheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.configuration.bucket }));
  }
}
