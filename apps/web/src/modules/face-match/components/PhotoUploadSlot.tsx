/**
 * PhotoUploadSlot — drag-drop or file-picker photo input with preview.
 *
 * Privacy / security:
 * - EXIF stripping: re-encodes the image through a <canvas> to remove all
 *   metadata (GPS, device serial, camera model) before the Blob is passed
 *   to the parent. This happens before any upload.
 * - Preview is held in component state (object URL) and revoked on unmount.
 *   It is NEVER written to localStorage or sessionStorage.
 * - Only JPEG and PNG are accepted (contract AC-1, §11).
 * - Max 5 MB (contract AC-1).
 * - Live-photo slot shows a "Use camera" button when mediaDevices is available.
 *
 * TODO (Expo): biometric camera capture is a separate slice in the mobile app.
 *   This component handles web-only capture via the HTML file input + getUserMedia.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Upload, Camera, X, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;

interface PhotoUploadSlotProps {
  /** "id-photo" | "live-photo" */
  slot: 'id-photo' | 'live-photo';
  label: string;
  hint?: string;
  onPhotoReady: (blob: Blob) => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * Strip EXIF by re-encoding through a canvas element.
 * Returns a new Blob with no metadata.
 */
async function stripExif(file: File): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob returned null'));
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

export function PhotoUploadSlot({
  slot,
  label,
  hint,
  onPhotoReady,
  onClear,
  disabled = false,
}: PhotoUploadSlotProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);

  const canUseCamera =
    slot === 'live-photo' && typeof navigator !== 'undefined' && !!navigator.mediaDevices;

  // Revoke preview URL on unmount or when cleared
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Stop camera stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setProcessing(true);

      // Validate MIME type
      if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
        setError(t('kyc.error_wrong_format'));
        setProcessing(false);
        return;
      }

      // Validate size
      if (file.size > MAX_SIZE_BYTES) {
        setError(t('kyc.error_too_large'));
        setProcessing(false);
        return;
      }

      try {
        const stripped = await stripExif(file);

        // Create preview — object URL, revoke old one first
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const newUrl = URL.createObjectURL(stripped);
        setPreviewUrl(newUrl);

        onPhotoReady(stripped);
      } catch {
        setError(t('kyc.error_process_failed'));
      } finally {
        setProcessing(false);
      }
    },
    [onPhotoReady, previewUrl],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      void processFile(file);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const handleClear = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClear();
  }, [previewUrl, onClear]);

  const handleStartCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      // Attach after state update (useEffect would be cleaner, but ref is immediate)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError(t('kyc.error_camera_denied'));
    }
  }, []);

  const handleCaptureFromCamera = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Stop stream
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCameraActive(false);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError(t('kyc.error_capture_failed'));
          return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const newUrl = URL.createObjectURL(blob);
        setPreviewUrl(newUrl);
        onPhotoReady(blob);
      },
      'image/jpeg',
      0.92,
    );
  }, [previewUrl, onPhotoReady]);

  const handleCancelCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const testId = slot === 'id-photo' ? 'face-match-id-slot' : 'face-match-live-slot';
  const previewTestId = slot === 'id-photo' ? 'face-match-id-preview' : 'face-match-live-preview';

  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="label" htmlFor={inputId}>
        {label}
        {hint && <span className="ml-1 text-muted font-normal">{hint}</span>}
      </label>

      {/* Camera view */}
      {cameraActive && (
        <div className="relative rounded-card overflow-hidden border border-border bg-ink">
          <video
            ref={videoRef}
            className="w-full object-cover max-h-64"
            autoPlay
            playsInline
            muted
            aria-label={t('kyc.camera_live_label')}
          />
          <div className="absolute bottom-0 inset-x-0 flex justify-center gap-3 pb-3">
            <Button
              type="button"
              size="sm"
              onClick={handleCaptureFromCamera}
            >
              {t('kyc.camera_capture')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCancelCamera}
            >
              {t('kyc.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Preview */}
      {!cameraActive && previewUrl && (
        <div className="relative rounded-card border border-border overflow-hidden bg-raised">
          {/* Never display ID back to user — only show preview for live-photo */}
          {slot === 'live-photo' ? (
            <img
              src={previewUrl}
              alt={t('kyc.preview_alt_live')}
              data-testid={previewTestId}
              className="w-full object-cover max-h-48"
            />
          ) : (
            /* ID photo: show filename placeholder (privacy: no image displayed) */
            <div
              data-testid={previewTestId}
              className="flex flex-col items-center justify-center gap-2 py-8 text-center"
              aria-label={t('kyc.id_photo_received_aria')}
            >
              <ImageOff size={24} className="text-muted" aria-hidden="true" />
              <span className="text-xs text-ink-sub">{t('kyc.id_photo_ready')}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleClear}
            aria-label={t('kyc.remove_photo_aria')}
            className="absolute top-2 right-2 rounded-full bg-ink/60 p-1 text-white hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Drop zone / file picker (hidden when camera active or preview shown) */}
      {!cameraActive && !previewUrl && (
        <div
          role="group"
          aria-label={t('kyc.dropzone_aria', { slot: label })}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed py-8 transition',
            dragOver ? 'border-brand-blue bg-brand-skyLight' : 'border-border bg-raised',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Upload size={22} className="text-muted" aria-hidden="true" />
          <p className="text-xs text-ink-sub text-center px-4">
            {t('kyc.dropzone_hint')}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || processing}
              loading={processing}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('kyc.choose_file')}
            </Button>
            {canUseCamera && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || processing}
                onClick={() => void handleStartCamera()}
              >
                <Camera size={13} aria-hidden="true" />
                {t('kyc.use_camera')}
              </Button>
            )}
          </div>
          <p className="text-2xs text-muted">{t('kyc.file_constraints')}</p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="sr-only"
        aria-label={label}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Validation error */}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
