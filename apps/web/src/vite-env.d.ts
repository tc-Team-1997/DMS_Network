/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FF_OCR_CONFIDENCE_TUNING?: string;
  readonly VITE_FF_AML_LIVE?: string;
  readonly VITE_FF_CBS_LIVE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
