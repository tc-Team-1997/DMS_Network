export { sha256 } from "./hash.js";

export interface PutResult { key: string; size: number; hash: string; }

export interface StorageBackend {
  put(buf: Buffer): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /**
   * Optional: a time-limited URL the client can fetch the blob from directly
   * (e.g. an S3/MinIO presigned GET), letting downloads bypass the core proxy.
   * Returns null when presigning isn't available; backends without object
   * storage (local fs) omit it entirely, so callers must feature-detect.
   */
  presignedGetUrl?(key: string, expiresSeconds?: number): Promise<string | null>;
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
export { S3Storage, tryCreateS3 } from "./s3.js";

/**
 * Pick a storage backend from config. With `storageDriver: "s3"` and a bucket,
 * build an S3/MinIO backend; if the SDK or required config is missing, log a
 * degraded warning and fall back to local so boot never fails on storage.
 */
export async function createStorage(cfg: StorageConfig): Promise<StorageBackend> {
  const { LocalStorage } = await import("./local.js");
  const localRoot = cfg.localRoot ?? "./.storage";

  if (cfg.storageDriver === "s3") {
    const { tryCreateS3 } = await import("./s3.js");
    const s3 = await tryCreateS3(cfg);
    if (s3) return s3;
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "storage_s3_unavailable_fallback_local",
        detail: "STORAGE_DRIVER=s3 but the AWS SDK or S3_BUCKET/credentials are missing; using local storage.",
      }),
    );
  }
  return LocalStorage(localRoot);
}
