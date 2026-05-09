/**
 * FaceMatchPage — /admin/kyc/face-match
 *
 * Visible to Maker and Doc Admin only (RBAC gate enforced here + in node route).
 * Feature-flagged by VITE_FF_FACE_MATCH_KYC (default off in all environments).
 *
 * Workflow:
 * 1. User enters customer CID.
 * 2. ConsentDialog shown → user reads + checks consent box → acceptConsent()
 *    → JWT token stored in sessionStorage.
 * 3. User uploads ID photo and live photo via PhotoUploadSlot (EXIF stripped).
 * 4. Submit → performMatch() → MatchResultCard rendered.
 *
 * Privacy enforcements:
 * - No biometric capture before consent token is present.
 * - Photo previews (object URLs) held only in React state — never persisted.
 * - ID photo is never re-displayed after upload; only filename label shown.
 * - Session storage is cleared automatically on tab close.
 *
 * TODO (Expo bridge): biometric camera capture in the mobile app is a separate
 *   slice (apps/mobile/src/modules/kyc/). This web page is for branch officers
 *   on desktop/tablet. Tag: MOBILE_TODO_BIOMETRIC_CAPTURE
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ScanFace, ShieldAlert } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { HttpError } from '@/lib/http';
import { performMatch } from './api';
import { ConsentDialog, CONSENT_TOKEN_KEY, CONSENT_EXPIRES_KEY } from './components/ConsentDialog';
import { PhotoUploadSlot } from './components/PhotoUploadSlot';
import { MatchResultCard } from './components/MatchResultCard';
import type { FaceMatchResult } from './schemas';

// ── Feature flag ───────────────────────────────────────────────────────────────

const FF_FACE_MATCH_KYC: boolean =
  import.meta.env['VITE_FF_FACE_MATCH_KYC'] === 'true';

// ── Consent token helpers ──────────────────────────────────────────────────────

function readConsentToken(): string | null {
  const token = sessionStorage.getItem(CONSENT_TOKEN_KEY);
  const expires = sessionStorage.getItem(CONSENT_EXPIRES_KEY);
  if (!token || !expires) return null;
  // Treat as expired if within 60 s of expiry
  const expiresAt = new Date(expires).getTime();
  if (Date.now() >= expiresAt - 60_000) {
    sessionStorage.removeItem(CONSENT_TOKEN_KEY);
    sessionStorage.removeItem(CONSENT_EXPIRES_KEY);
    return null;
  }
  return token;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function FaceMatchPage() {
  const formId = useId();
  const cidInputId = `${formId}-cid`;

  const role = useAuth((s) => s.user?.role);
  const canAccess = role === 'Maker' || role === 'Doc Admin';

  const [cid, setCid] = useState('');
  const [cidError, setCidError] = useState<string | null>(null);

  const [idPhotoBlob, setIdPhotoBlob] = useState<Blob | null>(null);
  const [livePhotoBlob, setLivePhotoBlob] = useState<Blob | null>(null);

  const [consentToken, setConsentToken] = useState<string | null>(() => readConsentToken());
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const [result, setResult] = useState<FaceMatchResult | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);

  // Re-check consent token expiry on mount (tab may have been open a while)
  useEffect(() => {
    setConsentToken(readConsentToken());
  }, []);

  const mutation = useMutation({
    mutationFn: ({
      id,
      live,
      token,
    }: {
      id: Blob;
      live: Blob;
      token: string;
    }) => performMatch(id, live, cid.trim(), token),
    onSuccess: (data) => {
      setResult(data);
      setServerErr(null);
    },
    onError: (e: unknown) => {
      if (e instanceof HttpError) {
        if (e.status === 403) {
          // Consent expired server-side — clear local token and prompt again
          sessionStorage.removeItem(CONSENT_TOKEN_KEY);
          sessionStorage.removeItem(CONSENT_EXPIRES_KEY);
          setConsentToken(null);
          setServerErr(t('kyc.error_consent_expired'));
        } else if (e.status === 429) {
          setServerErr(t('kyc.error_rate_limited'));
        } else if (e.status === 501) {
          setServerErr(t('kyc.error_feature_disabled'));
        } else {
          setServerErr(e.message);
        }
      } else {
        setServerErr(t('kyc.error_generic'));
      }
    },
  });

  const validateCid = useCallback((): boolean => {
    const trimmed = cid.trim();
    if (!trimmed) {
      setCidError(t('kyc.cid_required'));
      return false;
    }
    if (trimmed.length < 3 || trimmed.length > 64) {
      setCidError(t('kyc.cid_invalid'));
      return false;
    }
    setCidError(null);
    return true;
  }, [cid]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setServerErr(null);

      if (!validateCid()) return;
      if (!idPhotoBlob) {
        setServerErr(t('kyc.error_id_required'));
        return;
      }
      if (!livePhotoBlob) {
        setServerErr(t('kyc.error_live_required'));
        return;
      }

      // Consent gate — check stored token first, then prompt
      const token = readConsentToken();
      if (!token) {
        setConsentToken(null);
        setShowConsentDialog(true);
        return;
      }

      mutation.mutate({ id: idPhotoBlob, live: livePhotoBlob, token });
    },
    [validateCid, idPhotoBlob, livePhotoBlob, mutation],
  );

  const handleConsentAccepted = useCallback((token: string) => {
    setConsentToken(token);
    setShowConsentDialog(false);
    // If photos already chosen, submit immediately
    if (idPhotoBlob && livePhotoBlob && cid.trim()) {
      mutation.mutate({ id: idPhotoBlob, live: livePhotoBlob, token });
    }
  }, [idPhotoBlob, livePhotoBlob, cid, mutation]);

  const handleReset = useCallback(() => {
    setResult(null);
    setServerErr(null);
    setIdPhotoBlob(null);
    setLivePhotoBlob(null);
  }, []);

  // ── Feature flag gate ────────────────────────────────────────────────────────

  if (!FF_FACE_MATCH_KYC) {
    return (
      <div
        data-testid="face-match-page"
        className="flex flex-col items-center justify-center py-20 text-center space-y-3"
      >
        <ShieldAlert size={32} className="text-muted" aria-hidden="true" />
        <p className="text-md font-medium text-ink">{t('kyc.feature_disabled')}</p>
        <p className="text-xs text-muted">{t('kyc.feature_disabled_hint')}</p>
      </div>
    );
  }

  // ── RBAC gate ────────────────────────────────────────────────────────────────

  if (!canAccess) {
    return (
      <div
        data-testid="face-match-page"
        className="flex flex-col items-center justify-center py-20 text-center space-y-3"
      >
        <ShieldAlert size={32} className="text-danger" aria-hidden="true" />
        <p className="text-md font-medium text-ink">{t('kyc.error_forbidden')}</p>
        <p className="text-xs text-muted">{t('kyc.error_forbidden_hint')}</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div data-testid="face-match-page" className="space-y-6 max-w-2xl">

        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <ScanFace size={20} className="text-brand-blue" aria-hidden="true" />
            {t('kyc.page_title')}
          </h1>
          <p className="text-xs text-muted mt-1">{t('kyc.page_subtitle')}</p>
        </div>

        {/* Consent status banner */}
        {!consentToken && !result && (
          <div
            role="status"
            className="flex items-center justify-between gap-4 rounded-input border border-warning/40 bg-warning-bg px-4 py-2.5"
          >
            <p className="text-xs text-warning">{t('kyc.consent_required_banner')}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowConsentDialog(true)}
              disabled={!cid.trim()}
            >
              {t('kyc.review_consent')}
            </Button>
          </div>
        )}

        {/* Match result */}
        {result && (
          <MatchResultCard result={result} onReset={handleReset} />
        )}

        {/* Form (hidden after successful match) */}
        {!result && (
          <form
            id={formId}
            onSubmit={handleSubmit}
            noValidate
            className="space-y-6"
          >
            {/* CID input */}
            <div>
              <Input
                id={cidInputId}
                data-testid="face-match-cid-input"
                label={t('kyc.cid_label')}
                placeholder={t('kyc.cid_placeholder')}
                value={cid}
                onChange={(e) => {
                  setCid(e.target.value);
                  if (cidError) setCidError(null);
                }}
                onBlur={validateCid}
                {...(cidError !== null ? { error: cidError } : {})}
                aria-required="true"
                disabled={mutation.isPending}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Photo slots */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <PhotoUploadSlot
                slot="id-photo"
                label={t('kyc.id_photo_label')}
                hint={t('kyc.photo_hint')}
                onPhotoReady={setIdPhotoBlob}
                onClear={() => setIdPhotoBlob(null)}
                disabled={mutation.isPending}
              />
              <PhotoUploadSlot
                slot="live-photo"
                label={t('kyc.live_photo_label')}
                hint={t('kyc.photo_hint')}
                onPhotoReady={setLivePhotoBlob}
                onClear={() => setLivePhotoBlob(null)}
                disabled={mutation.isPending}
              />
            </div>

            {/* Server error */}
            {serverErr && (
              <div
                role="alert"
                className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
              >
                {serverErr}
              </div>
            )}

            {/* Submit */}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                data-testid="face-match-submit"
                loading={mutation.isPending}
                disabled={mutation.isPending || !cid.trim() || !idPhotoBlob || !livePhotoBlob}
              >
                {t('kyc.submit_button')}
              </Button>
              {!consentToken && (
                <p className="text-2xs text-muted">{t('kyc.consent_required_note')}</p>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Consent dialog — rendered outside form flow */}
      {showConsentDialog && cid.trim() && (
        <ConsentDialog
          customerCid={cid.trim()}
          onAccepted={handleConsentAccepted}
          onClose={() => setShowConsentDialog(false)}
        />
      )}
    </>
  );
}
