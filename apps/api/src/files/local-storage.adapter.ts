import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { StorageAdapter, StoredObject } from "./storage.adapter";

export class LocalStorageAdapter implements StorageAdapter {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (
      isAbsolute(key) ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)
    ) {
      throw new Error("Invalid local storage key");
    }
    const target = resolve(this.root, ...key.split("/"));
    const relation = relative(this.root, target);
    if (
      relation === "" ||
      relation === ".." ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    ) {
      throw new Error("Storage key escapes the configured root");
    }
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      return { key, body: await readFile(this.path(key)) };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
