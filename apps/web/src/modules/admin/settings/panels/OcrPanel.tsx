import { ConfigPanel } from '../ConfigPanel';

export function OcrPanel() {
  return (
    <ConfigPanel
      namespace="ocr"
      title="OCR"
      description="OCR engine configuration. DocBrain wave modules will publish this schema."
    />
  );
}
