import { sha256 } from "./hash.js";
import { keyForHash, type StorageBackend, type PutResult, type StorageConfig } from "./index.js";

/**
 * Minimal S3 surface this backend depends on — lets tests inject a fake client
 * without standing up MinIO/S3 (same injectable pattern used across the AI features).
 * The real `@aws-sdk/client-s3` S3Client satisfies this structurally.
 */
export interface S3ClientLike {
  send(command: unknown): Promise<{ Body?: unknown }>;
}

export interface S3Deps {
  /** Pre-built client (tests inject a fake; prod builds one from StorageConfig). */
  client: S3ClientLike;
  bucket: string;
  /** Command constructors — injectable so tests avoid importing the AWS SDK. */
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
}

/** Collect a Node Readable / web stream / Buffer body into a single Buffer. */
async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  // AWS SDK v3 Node stream helper, when present.
  const maybe = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybe.transformToByteArray === "function") {
    return Buffer.from(await maybe.transformToByteArray());
  }
  // Generic async-iterable (Node Readable).
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Content-addressed S3/MinIO storage. Keys mirror the local driver
 * (`keyForHash`) so a bucket and a local root are interchangeable.
 */
export function S3Storage(deps: S3Deps): StorageBackend {
  const { client, bucket, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = deps;

  const headExists = async (key: string): Promise<boolean> => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    async put(buf: Buffer): Promise<PutResult> {
      const hash = sha256(buf);
      const key = keyForHash(hash);
      // Content-addressed: identical bytes => identical key, so skip re-upload.
      if (!(await headExists(key))) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf }));
      }
      return { key, size: buf.length, hash };
    },
    async get(key: string): Promise<Buffer> {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return bodyToBuffer(res.Body);
    },
    async exists(key: string): Promise<boolean> {
      return headExists(key);
    },
    async delete(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        /* already gone / not found */
      }
    },
  };
}

/**
 * Build a real S3 backend from config using the installed AWS SDK. Returns null
 * if the SDK can't be loaded or required config is missing, so the factory can
 * fall back to local rather than crashing boot (degraded, but never down).
 */
export async function tryCreateS3(cfg: StorageConfig): Promise<StorageBackend | null> {
  if (!cfg.s3Bucket) return null;
  try {
    const sdk = await import("@aws-sdk/client-s3");
    const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = sdk;
    const client = new S3Client({
      region: cfg.s3Region ?? "us-east-1",
      endpoint: cfg.s3Endpoint,            // set for MinIO / S3-compatible
      forcePathStyle: Boolean(cfg.s3Endpoint), // MinIO needs path-style addressing
      ...(cfg.s3AccessKey && cfg.s3SecretKey
        ? { credentials: { accessKeyId: cfg.s3AccessKey, secretAccessKey: cfg.s3SecretKey } }
        : {}),
    });
    return S3Storage({
      client: client as unknown as S3ClientLike,
      bucket: cfg.s3Bucket,
      PutObjectCommand: PutObjectCommand as unknown as S3Deps["PutObjectCommand"],
      GetObjectCommand: GetObjectCommand as unknown as S3Deps["GetObjectCommand"],
      HeadObjectCommand: HeadObjectCommand as unknown as S3Deps["HeadObjectCommand"],
      DeleteObjectCommand: DeleteObjectCommand as unknown as S3Deps["DeleteObjectCommand"],
    });
  } catch {
    return null;
  }
}
