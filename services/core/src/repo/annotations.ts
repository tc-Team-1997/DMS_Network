import type { Knex } from "knex";
import { newId } from "@zordms/db";

export type AnnotationKind = "note" | "highlight" | "redaction" | "stamp";

export interface Annotation {
  id: string;
  document_id: string;
  page: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  color?: string;
  created_by?: string;
  created_at?: string;
}

const KINDS: AnnotationKind[] = ["note", "highlight", "redaction", "stamp"];

export async function createAnnotation(
  knex: Knex,
  docId: string,
  args: {
    kind: AnnotationKind;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    content?: string;
    color?: string;
    createdBy?: string;
  },
): Promise<Annotation> {
  if (!KINDS.includes(args.kind)) throw new Error(`invalid_kind:${args.kind}`);
  const id = newId();
  await knex("annotations").insert({
    id,
    document_id: docId,
    kind: args.kind,
    page: args.page,
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    content: args.content ?? null,
    color: args.color ?? null,
    created_by: args.createdBy ?? null,
  });
  return (await knex("annotations").where({ id }).first()) as Annotation;
}

export async function listAnnotations(knex: Knex, docId: string): Promise<Annotation[]> {
  return (await knex("annotations").where({ document_id: docId }).orderBy("id")) as Annotation[];
}

export async function deleteAnnotation(knex: Knex, id: string, documentId: string): Promise<boolean> {
  // C4: enforce document_id ownership to prevent cross-document IDOR
  const deleted = await knex("annotations").where({ id, document_id: documentId }).del();
  return deleted > 0;
}
