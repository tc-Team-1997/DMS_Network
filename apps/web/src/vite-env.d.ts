/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FF_OCR_CONFIDENCE_TUNING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
