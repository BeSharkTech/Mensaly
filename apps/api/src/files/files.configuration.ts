import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiEnvironment } from "@mensaly/config";

type FilesConfiguration = {
  root: string;
  sizeLimit: number;
};

let configuration: FilesConfiguration = {
  root: ".local-storage",
  sizeLimit: 5 * 1024 * 1024,
};

export function configureFiles(environment: ApiEnvironment): void {
  configuration = {
    root:
      environment.NODE_ENV === "test" &&
      environment.LOCAL_STORAGE_PATH === ".local-storage"
        ? join(tmpdir(), "mensaly-test-storage")
        : environment.LOCAL_STORAGE_PATH,
    sizeLimit: environment.FILE_MAX_SIZE_BYTES,
  };
}

export function filesConfiguration(): FilesConfiguration {
  return configuration;
}
