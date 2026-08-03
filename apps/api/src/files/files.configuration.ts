import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiEnvironment } from "@mensaly/config";

type FilesConfiguration = {
  root: string;
  sizeLimit: number;
  driver: "local" | "s3";
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  } | null;
};

let configuration: FilesConfiguration = {
  root: ".local-storage",
  sizeLimit: 5 * 1024 * 1024,
  driver: "local",
  s3: null,
};

export function configureFiles(environment: ApiEnvironment): void {
  configuration = {
    root:
      environment.NODE_ENV === "test" &&
      environment.LOCAL_STORAGE_PATH === ".local-storage"
        ? join(tmpdir(), "mensaly-test-storage")
        : environment.LOCAL_STORAGE_PATH,
    sizeLimit: environment.FILE_MAX_SIZE_BYTES,
    driver: environment.FILE_STORAGE_DRIVER,
    s3:
      environment.FILE_STORAGE_DRIVER === "s3"
        ? {
            endpoint: environment.S3_ENDPOINT!,
            region: environment.S3_REGION,
            bucket: environment.S3_BUCKET!,
            accessKeyId: environment.S3_ACCESS_KEY_ID!,
            secretAccessKey: environment.S3_SECRET_ACCESS_KEY!,
            forcePathStyle: environment.S3_FORCE_PATH_STYLE,
          }
        : null,
  };
}

export function filesConfiguration(): FilesConfiguration {
  return configuration;
}
