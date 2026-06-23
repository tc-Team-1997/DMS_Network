import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "./hash.js";
import { keyForHash, type StorageBackend, type PutResult } from "./index.js";

export function LocalStorage(rootDir: string): StorageBackend {
  const pathFor = (key: string) => join(rootDir, key);

  return {
    async put(buf: Buffer): Promise<PutResult> {
      const hash = sha256(buf);
      const key = keyForHash(hash);
      const abs = pathFor(key);
      try {
        await access(abs);
      } catch {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, buf);
      }
      return { key, size: buf.length, hash };
    },
    async get(key: string): Promise<Buffer> {
      return readFile(pathFor(key));
    },
    async exists(key: string): Promise<boolean> {
      try { await access(pathFor(key)); return true; } catch { return false; }
    },
    async delete(key: string): Promise<void> {
      try { await unlink(pathFor(key)); } catch { /* already gone */ }
    },
  };
}
