import type { Knex } from "knex";
import type { StorageBackend } from "../storage/index.js";
import { type EventBus, EVENTS } from "../events/index.js";

export interface CaptureDeps { knex: Knex; storage: StorageBackend; events: EventBus; }

export interface DocumentRecord {
  id: number;
  folder_id?: number | null;
  title: string;
  original_filename?: string;
  mime_type?: string;
  current_version: number;
  file_hash_sha256: string;
  source_channel: string;
  ingest_user_id?: string;
  page_count: number;
  file_size_bytes: number;
  ocr_engine?: string;
  processing_ms?: number;
  retention_years?: number;
  destruction_date?: string;
  doc_type?: string;
  metadata?: string;
  catalog_category?: string;
  review_flag: boolean;
  confidence?: number;
  branch?: string;
  status: string;
  ingest_timestamp?: string;
  cid?: string | null;
  doc_no?: string | null;
  extraction_status?: string;
  extracted_at?: string;
}

export interface DocumentVersion {
  id: number;
  document_id: number;
  version_no: number;
  storage_key: string;
  file_hash_sha256: string;
  file_size_bytes: number;
  mime_type?: string;
  created_by?: string;
  comment?: string;
  created_at?: string;
}

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function captureDocument(
  deps: CaptureDeps,
  args: {
    title: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
    branch?: string;
    ingestUserId?: string;
    sourceChannel?: string;
    folderId?: number | null;
  },
): Promise<DocumentRecord> {
  const stored = await deps.storage.put(args.buffer);
  const insertedDoc = await deps.knex("documents").insert({
    folder_id: args.folderId ?? null,
    title: args.title,
    original_filename: args.filename,
    mime_type: args.mimeType,
    current_version: 1,
    file_hash_sha256: stored.hash,
    source_channel: args.sourceChannel ?? "UPLOAD",
    ingest_user_id: args.ingestUserId ?? null,
    page_count: 1,
    file_size_bytes: stored.size,
    branch: args.branch ?? null,
    status: "Active",
  }).returning("id");
  const docId = idOf(insertedDoc);

  await deps.knex("document_versions").insert({
    document_id: docId,
    version_no: 1,
    storage_key: stored.key,
    file_hash_sha256: stored.hash,
    file_size_bytes: stored.size,
    mime_type: args.mimeType,
    created_by: args.ingestUserId ?? null,
    comment: "initial capture",
  });

  await deps.events.emit(EVENTS.DOCUMENT_CAPTURED, { docId, branch: args.branch ?? null, hash: stored.hash });
  return (await deps.knex("documents").where({ id: docId }).first()) as DocumentRecord;
}

export async function listDocuments(
  knex: Knex,
  viewer: { branch?: string; canCrossBranch: boolean },
): Promise<DocumentRecord[]> {
  // I1: fail-closed — users without crossbranch:read AND without a branch see nothing
  if (!viewer.canCrossBranch && !viewer.branch) return [];
  const q = knex("documents").whereNot({ status: "Deleted" });
  if (!viewer.canCrossBranch) q.andWhere({ branch: viewer.branch });
  return (await q.orderBy("id", "desc")).map(normalizeDoc) as DocumentRecord[];
}

export async function getDocument(
  knex: Knex,
  id: number,
  viewer?: { branch?: string; canCrossBranch: boolean },
): Promise<DocumentRecord | undefined> {
  // C1: branch-aware fetch; fail-closed when viewer has no branch and no crossbranch:read
  const q = knex("documents").where({ id }).whereNot({ status: "Deleted" });
  if (viewer) {
    if (!viewer.canCrossBranch) {
      if (!viewer.branch) return undefined; // no branch, no access
      q.andWhere({ branch: viewer.branch });
    }
  }
  const row = await q.first();
  return row ? normalizeDoc(row) : undefined;
}

function normalizeDoc(row: Record<string, unknown>): DocumentRecord {
  // I7: normalize SQLite boolean 0/1 to true/false
  return { ...row, review_flag: Boolean(row.review_flag) } as DocumentRecord;
}

export async function softDeleteDocument(knex: Knex, id: number): Promise<void> {
  await knex("documents").where({ id }).update({ status: "Deleted" });
}

export async function currentVersion(knex: Knex, id: number): Promise<DocumentVersion | undefined> {
  const doc = await knex("documents").where({ id }).first();
  if (!doc) return undefined;
  return (await knex("document_versions").where({ document_id: id, version_no: doc.current_version }).first()) as DocumentVersion | undefined;
}
