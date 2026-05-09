import type { PreviewResponse } from './api';
import type { AutoRouted } from './api';

/** Form state is a string dictionary keyed by field.key. */
export type FormState = Record<string, string>;

export type CardStatus =
  | { tag: 'idle' }
  | { tag: 'scanning' }
  | { tag: 'ready'; preview: PreviewResponse }
  | { tag: 'scan_error'; message: string }
  | { tag: 'uploading' }
  | { tag: 'done'; uploadId: number; autoRouted: AutoRouted | null }
  | { tag: 'upload_error'; message: string };

export interface FileCard {
  id: string;
  file: File;
  objectUrl: string;
  form: FormState;
  /** Map of field.key → AI confidence (0–1) for AI-filled fields. */
  aiFilled: Record<string, number>;
  /** Map of field.key → original AI-extracted value, preserved for "Revert". */
  aiOriginalValues: Record<string, string>;
  /** Set of field keys the user has manually edited. */
  manualEdits: Record<string, true>;
  /** Set of field keys the user has locked (prevents accidental overwrite). */
  lockedFields: Record<string, true>;
  docTypeId: number | null;
  status: CardStatus;
}

export type PipelineStep = 'uploaded' | 'ocr' | 'classify' | 'indexed';

export interface PipelineStepDef {
  id: PipelineStep;
  label: string;
}
