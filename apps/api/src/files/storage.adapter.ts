export type StoredObject = {
  key: string;
  body: Buffer;
};

export interface StorageAdapter {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");
export const FILE_SIZE_LIMIT = Symbol("FILE_SIZE_LIMIT");
