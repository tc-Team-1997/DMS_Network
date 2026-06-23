export { sha256 } from "./hash.js";

export interface PutResult { key: string; size: number; hash: string; }

export interface StorageBackend {
  put(buf: Buffer): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface StorageConfig {
  storageDriver: "local" | "s3";
  localRoot: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
}

export function keyForHash(hash: string): string {
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

export { LocalStorage } from "./local.js";

export async function createStorage(cfg: StorageConfig): Promise<StorageBackend> {
  const { LocalStorage } = await import("./local.js");
  // S3 backend not implemented in core service - use local for all environments
  return LocalStorage(cfg.localRoot ?? "./.storage");
}
