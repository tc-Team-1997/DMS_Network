/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FF_OCR_CONFIDENCE_TUNING?: string;
  readonly VITE_FF_AML_LIVE?: string;
  readonly VITE_FF_CBS_LIVE?: string;
  readonly VITE_FF_WORM?: string;
  readonly VITE_FF_REDACTION?: string;
  readonly VITE_FF_DZONGKHA_TRANSLATION?: string;
  /** Face Match KYC biometric verification. Default off. Set to 'true' to enable. */
  readonly VITE_FF_FACE_MATCH_KYC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
