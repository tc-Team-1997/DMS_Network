import { z } from 'zod';

// ── Translation result (POST /spa/api/translate/document/{id}) ──────────────

export const TranslationResult = z.object({
  doc_id: z.number().int(),
  source_lang: z.string().length(2),
  target_lang: z.string().length(2),
  original_text_preview: z.string(),
  translated_text: z.string(),
  translated_at: z.string().datetime(),
  confidence_estimate: z.number().min(0).max(1),
  cache_hit: z.boolean(),
  model_version: z.string().optional(),
});
export type TranslationResult = z.infer<typeof TranslationResult>;

// ── Inline text translation (POST /spa/api/translate) ───────────────────────

export const TextTranslationRequest = z.object({
  text: z.string().min(1).max(512_000),
  source_lang: z.string().length(2),
  target_lang: z.string().length(2),
});
export type TextTranslationRequest = z.infer<typeof TextTranslationRequest>;

export const TextTranslationResult = z.object({
  original_text: z.string(),
  translated_text: z.string(),
  source_lang: z.string().length(2),
  target_lang: z.string().length(2),
  confidence_estimate: z.number().min(0).max(1),
  cache_hit: z.boolean(),
  cached_at: z.string().datetime().optional(),
});
export type TextTranslationResult = z.infer<typeof TextTranslationResult>;

// ── Supported language pairs (GET /spa/api/translate/languages) ──────────────

export const LanguagePair = z.object({
  source: z.string().length(2),
  target: z.string().length(2),
});
export type LanguagePair = z.infer<typeof LanguagePair>;

export const SupportedLanguages = z.object({
  supported_pairs: z.array(LanguagePair),
});
export type SupportedLanguages = z.infer<typeof SupportedLanguages>;

// ── Supported target language union used by UI components ────────────────────

export const TargetLangSchema = z.enum(['en', 'dz', 'ar']);
export type TargetLang = z.infer<typeof TargetLangSchema>;

export const TARGET_LANG_LABELS: Record<TargetLang, string> = {
  en: 'English',
  dz: 'Dzongkha',
  ar: 'Arabic',
};
