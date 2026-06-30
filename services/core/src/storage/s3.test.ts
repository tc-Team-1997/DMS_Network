/**
 * S3/MinIO storage backend — exercised against an in-memory fake S3 client
 * (no live MinIO needed), plus the factory's graceful fallback to local.
 */
import { describe, it, expect } from "vitest";
import { S3Storage, type S3ClientLike } from "./s3.js";
import { createStorage, keyForHash } from "./index.js";
import { sha256 } from "./hash.js";

/** Minimal in-memory stand-in for the AWS SDK command/client pair. */
function makeFakeS3() {
  const store = new Map<string, Buffer>();
  // Command "constructors" just tag the op + carry input for the client to read.
  const cmd = (op: string) =>
    class {
      input: Record<string, unknown>;
      op = op;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    };
  const PutObjectCommand = cmd("put");
  const GetObjectCommand = cmd("get");
  const HeadObjectCommand = cmd("head");
  const DeleteObjectCommand = cmd("delete");

  const client: S3ClientLike = {
    async send(command: unknown): Promise<{ Body?: unknown }> {
      const c = command as { op: string; input: Record<string, unknown> };
      const key = String(c.input.Key);
      switch (c.op) {
        case "put":
          store.set(key, c.input.Body as Buffer);
          return {};
        case "get": {
          if (!store.has(key)) throw new Error("NoSuchKey");
          return { Body: store.get(key) };
        }
        case "head":
          if (!store.has(key)) throw new Error("NotFound");
          return {};
        case "delete":
          store.delete(key);
          return {};
        default:
          throw new Error(`unexpected op ${c.op}`);
      }
    },
  };

  return { store, client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
}

function makeBackend() {
  const f = makeFakeS3();
  const backend = S3Storage({
    client: f.client,
    bucket: "zordms-docs",
    PutObjectCommand: f.PutObjectCommand,
    GetObjectCommand: f.GetObjectCommand,
    HeadObjectCommand: f.HeadObjectCommand,
    DeleteObjectCommand: f.DeleteObjectCommand,
  });
  return { f, backend };
}

describe("S3Storage", () => {
  it("put returns a content-addressed key matching keyForHash(sha256(buf))", async () => {
    const { backend } = makeBackend();
    const buf = Buffer.from("hello dzongkha world");
    const res = await backend.put(buf);
    expect(res.hash).toBe(sha256(buf));
    expect(res.key).toBe(keyForHash(res.hash));
    expect(res.size).toBe(buf.length);
  });

  it("round-trips bytes through put → get", async () => {
    const { backend } = makeBackend();
    const buf = Buffer.from([0, 1, 2, 250, 251, 255]);
    const { key } = await backend.put(buf);
    const got = await backend.get(key);
    expect(Buffer.compare(got, buf)).toBe(0);
  });

  it("exists reflects presence; delete makes it absent", async () => {
    const { backend } = makeBackend();
    const { key } = await backend.put(Buffer.from("x"));
    expect(await backend.exists(key)).toBe(true);
    await backend.delete(key);
    expect(await backend.exists(key)).toBe(false);
  });

  it("is content-addressed: identical bytes do not re-upload", async () => {
    const { f, backend } = makeBackend();
    let puts = 0;
    const realSend = f.client.send;
    f.client.send = async (command: unknown) => {
      if ((command as { op: string }).op === "put") puts++;
      return realSend.call(f.client, command);
    };
    const buf = Buffer.from("dedupe me");
    await backend.put(buf);
    await backend.put(buf); // same bytes → key already exists → skip
    expect(puts).toBe(1);
  });

  it("delete on a missing key is a no-op (never throws)", async () => {
    const { backend } = makeBackend();
    await expect(backend.delete(" no/such/key")).resolves.toBeUndefined();
  });

  it("presignedGetUrl returns null when no signer is injected", async () => {
    const { backend } = makeBackend(); // no getSignedUrl
    expect(await backend.presignedGetUrl!("aa/bb/aabb")).toBeNull();
  });

  it("presignedGetUrl delegates to the injected signer with the right expiry", async () => {
    const f = makeFakeS3();
    let seenExpiry = 0;
    const backend = S3Storage({
      client: f.client,
      bucket: "zordms-docs",
      PutObjectCommand: f.PutObjectCommand,
      GetObjectCommand: f.GetObjectCommand,
      HeadObjectCommand: f.HeadObjectCommand,
      DeleteObjectCommand: f.DeleteObjectCommand,
      getSignedUrl: async (_client, _command, opts) => {
        seenExpiry = opts.expiresIn;
        return "https://bucket.example/aa/bb/aabb?sig=xyz";
      },
    });
    const url = await backend.presignedGetUrl!("aa/bb/aabb", 120);
    expect(url).toBe("https://bucket.example/aa/bb/aabb?sig=xyz");
    expect(seenExpiry).toBe(120);
  });

  it("presignedGetUrl returns null (never throws) if the signer fails", async () => {
    const f = makeFakeS3();
    const backend = S3Storage({
      client: f.client,
      bucket: "zordms-docs",
      PutObjectCommand: f.PutObjectCommand,
      GetObjectCommand: f.GetObjectCommand,
      HeadObjectCommand: f.HeadObjectCommand,
      DeleteObjectCommand: f.DeleteObjectCommand,
      getSignedUrl: async () => { throw new Error("signer boom"); },
    });
    expect(await backend.presignedGetUrl!("aa/bb/aabb")).toBeNull();
  });
});

describe("createStorage factory", () => {
  it("returns local when driver is 'local'", async () => {
    const s = await createStorage({ storageDriver: "local", localRoot: "./.storage-test" });
    // Local backend has the same shape; smoke-test the interface is present.
    expect(typeof s.put).toBe("function");
    expect(typeof s.get).toBe("function");
  });

  it("falls back to local when driver is 's3' but no bucket configured", async () => {
    const s = await createStorage({ storageDriver: "s3", localRoot: "./.storage-test" });
    expect(typeof s.put).toBe("function");
    // Round-trips via local fs, proving the fallback returned a working backend.
    const { key } = await s.put(Buffer.from("fallback ok"));
    expect(await s.exists(key)).toBe(true);
    await s.delete(key);
  });
});
