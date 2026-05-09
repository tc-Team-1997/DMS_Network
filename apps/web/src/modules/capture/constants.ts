import type { PipelineStepDef } from './types';

export const DEFAULT_AUTOFILL_FLOOR = 0.4;
export const DEFAULT_CONFIDENCE_HIGH = 0.7;

export const MAX_FILES = 25;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export const MAX_BYTES = 50 * 1024 * 1024;
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_MS = 60_000;

export const PIPELINE_STEPS: PipelineStepDef[] = [
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'ocr',      label: 'OCR Processing' },
  { id: 'classify', label: 'AI Classification' },
  { id: 'indexed',  label: 'Indexed' },
];
