export { TranslateButton } from './components/TranslateButton';
export { SideBySideView } from './components/SideBySideView';
export { TranslateInline } from './components/TranslateInline';
export { ConfidenceBadge } from './components/ConfidenceBadge';
export { translateDocument, translateText, getLanguages, deleteTranslation } from './api';
export type {
  TranslationResult,
  TextTranslationResult,
  TextTranslationRequest,
  SupportedLanguages,
  LanguagePair,
  TargetLang,
} from './schemas';
export { TARGET_LANG_LABELS, TargetLangSchema } from './schemas';
