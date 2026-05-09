import { del, get, post } from '@/lib/http';
import { z } from 'zod';
import {
  SupportedLanguages,
  TextTranslationResult,
  TranslationResult,
  type TargetLang,
  type TextTranslationRequest,
} from './schemas';

// ── Translate a document by ID ───────────────────────────────────────────────

/**
 * POST /spa/api/translate/document/{id}
 * Translates the document's OCR text to the requested target language.
 * Cached server-side for 7 days; reflect that with a matching staleTime.
 */
export function translateDocument(
  docId: number,
  target_lang: TargetLang,
): Promise<TranslationResult> {
  return post(
    `/spa/api/translate/document/${docId}`,
    { target_lang },
    TranslationResult,
  );
}

// ── Translate arbitrary text ─────────────────────────────────────────────────

/**
 * POST /spa/api/translate
 * Translates an arbitrary text snippet without document context.
 */
export function translateText(
  req: TextTranslationRequest,
): Promise<TextTranslationResult> {
  return post('/spa/api/translate', req, TextTranslationResult);
}

// ── List supported language pairs ────────────────────────────────────────────

/**
 * GET /spa/api/translate/languages
 * Returns language pairs enabled for the current tenant.
 */
export function getLanguages(): Promise<SupportedLanguages> {
  return get('/spa/api/translate/languages', SupportedLanguages);
}

// ── Delete a cached translation (DSAR / privacy) ─────────────────────────────

const DeleteResponseSchema = z.object({ deleted: z.literal(true) });

/**
 * DELETE /spa/api/translate/{translationId}
 * Removes a translation from the cache. Requires doc_admin role.
 */
export function deleteTranslation(
  translationId: number,
): Promise<z.infer<typeof DeleteResponseSchema>> {
  return del(`/spa/api/translate/${translationId}`, DeleteResponseSchema);
}
