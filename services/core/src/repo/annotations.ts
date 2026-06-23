import type { Knex } from "knex";

export type AnnotationKind = "note" | "highlight" | "redaction" | "stamp";

export interface Annotation {
  id: number;
  document_id: number;
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

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function createAnnotation(
  knex: Knex,
  docId: number,
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
  const inserted = await knex("annotations").insert({
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
  }).returning("id");
  const id = idOf(inserted);
  return (await knex("annotations").where({ id }).first()) as Annotation;
}

export async function listAnnotations(knex: Knex, docId: number): Promise<Annotation[]> {
  return (await knex("annotations").where({ document_id: docId }).orderBy("id")) as Annotation[];
}

export async function deleteAnnotation(knex: Knex, id: number): Promise<void> {
  await knex("annotations").where({ id }).del();
}
