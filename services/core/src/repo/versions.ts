import type { Knex } from "knex";
import type { StorageBackend } from "../storage/index.js";
import type { EventBus } from "../events/index.js";
import type { DocumentVersion } from "./documents.js";
import { newId } from "@zordms/db";

export interface VersionDeps { knex: Knex; storage: StorageBackend; events: EventBus; }

async function nextVersionNo(tx: Knex, docId: string): Promise<number> {
  const row = await tx("document_versions").where({ document_id: docId }).max("version_no as m");
  return Number(row[0]?.m ?? 0) + 1;
}

async function insertVersion(
  deps: VersionDeps,
  docId: string,
  args: { buffer: Buffer; mimeType?: string; createdBy?: string; comment?: string },
): Promise<DocumentVersion> {
  // I3: wrap the read-max + insert in a transaction to prevent version_no race conditions
  return deps.knex.transaction(async (tx) => {
    const stored = await deps.storage.put(args.buffer);
    const version_no = await nextVersionNo(tx, docId);
    const versionId = newId();
    await tx("document_versions").insert({
      id: versionId,
      document_id: docId,
      version_no,
      storage_key: stored.key,
      file_hash_sha256: stored.hash,
      file_size_bytes: stored.size,
      mime_type: args.mimeType ?? null,
      created_by: args.createdBy ?? null,
      comment: args.comment ?? null,
    });
    await tx("documents").where({ id: docId }).update({
      current_version: version_no,
      file_hash_sha256: stored.hash,
      file_size_bytes: stored.size,
    });
    return (await tx("document_versions").where({ id: versionId }).first()) as DocumentVersion;
  });
}

export async function addVersion(
  deps: VersionDeps,
  docId: string,
  args: { buffer: Buffer; mimeType?: string; createdBy?: string; comment?: string },
): Promise<DocumentVersion> {
  return insertVersion(deps, docId, args);
}

export async function listVersions(knex: Knex, docId: string): Promise<DocumentVersion[]> {
  return (await knex("document_versions").where({ document_id: docId }).orderBy("version_no", "desc")) as DocumentVersion[];
}

export async function rollback(
  deps: VersionDeps,
  docId: string,
  targetVersionNo: number,
): Promise<DocumentVersion> {
  const target = await deps.knex("document_versions").where({ document_id: docId, version_no: targetVersionNo }).first();
  if (!target) throw new Error("target_version_not_found");
  const buffer = await deps.storage.get(target.storage_key);
  return insertVersion(deps, docId, {
    buffer,
    mimeType: target.mime_type,
    createdBy: target.created_by,
    comment: `rollback to v${targetVersionNo}`,
  });
}
