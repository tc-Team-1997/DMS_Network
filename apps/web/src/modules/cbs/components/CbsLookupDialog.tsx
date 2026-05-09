/**
 * CbsLookupDialog — modal to look up a customer master record from Temenos T24.
 *
 * A11y:
 * - Focus trap: focus moves to CIF input on open; Tab cycles within dialog.
 * - ESC closes.
 * - All status updates via aria-live regions.
 * - Labels + aria-describedby on every input.
 * - No colour-only risk band signals (text label always present).
 *
 * Error states (per contract §11):
 * - Loading skeleton
 * - Network failure (retry)
 * - 400 invalid CIF (inline on input)
 * - 404 customer_not_found (toast in dialog)
 * - 403 forbidden (disabled controls + hint)
 * - 503 cbs_unavailable (full banner, stale cache if present)
 * - 429 rate_limited (toast with retry_after)
 * - 502 cbs_proxy_error (generic apology)
 * - 504 upstream_timeout (specific message)
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { Button, Badge, type BadgeTone } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchCbsCustomer, fetchCbsAccounts, invalidateCbsCustomerCache } from '../api';
import { StaleDataBanner } from './StaleDataBanner';
import type { CbsAccount } from '../schemas';

// ── CIF validation ────────────────────────────────────────────────────────

/** Matches Node-side validation: /^[A-Z0-9]{4,64}$/ */
const CIF_RE = /^[A-Z0-9]{4,64}$/;

function validateCif(raw: string): string | null {
  if (!raw.trim()) return t('cbs.error_cif_required');
  if (!CIF_RE.test(raw.trim()))
    return t('cbs.error_cif_format');
  return null;
}

// ── Risk band colours ─────────────────────────────────────────────────────

type RiskBand = 'low' | 'medium' | 'high';

const riskConfig: Record<RiskBand, { tone: BadgeTone; label: string }> = {
  low:    { tone: 'success', label: 'cbs.risk_low' },
  medium: { tone: 'warning', label: 'cbs.risk_medium' },
  high:   { tone: 'danger',  label: 'cbs.risk_high' },
};

// ── Error message helper ──────────────────────────────────────────────────

function mapError(err: unknown): { msg: string; isInput?: boolean; retryAfter?: number } {
  if (!(err instanceof HttpError)) {
    return { msg: t('cbs.error_network') };
  }
  switch (err.status) {
    case 400: return { msg: t('cbs.error_cif_format'), isInput: true };
    case 403: return { msg: t('cbs.error_forbidden') };
    case 404: return { msg: t('cbs.error_not_found') };
    case 429: {
      const ra =
        typeof err.data === 'object' && err.data !== null && 'retry_after' in err.data
          ? Number((err.data as { retry_after: unknown }).retry_after)
          : undefined;
      const base = { msg: t('cbs.error_rate_limited', { s: ra ?? '?' }) };
      return ra !== undefined ? { ...base, retryAfter: ra } : base;
    }
    case 502: return { msg: t('cbs.error_proxy') };
    case 503: return { msg: t('cbs.error_unavailable') };
    case 504: return { msg: t('cbs.error_timeout') };
    default:  return { msg: t('cbs.error_generic') };
  }
}

// ── Account list sub-component ────────────────────────────────────────────

function AccountList({ cif }: { cif: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cbs', 'accounts', cif],
    queryFn: () => fetchCbsAccounts(cif),
  });

  if (isLoading) {
    return (
      <div className="mt-2 space-y-1" aria-busy="true" aria-label={t('cbs.loading')}>
        {[0, 1].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-input bg-divider" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="mt-2 text-xs text-danger">{t('cbs.accounts_error')}</p>
    );
  }

  const accounts: CbsAccount[] = data?.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <p
        data-testid="cbs-empty-state"
        className="mt-2 text-xs text-muted"
      >
        {t('cbs.accounts_empty')}
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-1">
      {accounts.map((acc) => (
        <li
          key={acc.account_id}
          data-testid={`cbs-account-row-${acc.account_id}`}
          className="flex items-center justify-between rounded-input border border-border bg-raised px-3 py-2 text-xs"
        >
          <span className="font-mono text-ink">{acc.account_id}</span>
          <span className="text-muted">{acc.account_type}</span>
          <Badge tone={acc.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {acc.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────

export interface CbsLookupDialogProps {
  /** Pre-fill the CIF input when opened from a document card. */
  initialCif?: string;
  /** Whether the current user has cbs:admin permission (shows Refresh button). */
  canAdmin?: boolean;
  onClose: () => void;
}

export function CbsLookupDialog({
  initialCif = '',
  canAdmin = false,
  onClose,
}: CbsLookupDialogProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const liveId  = `${dialogId}-live`;
  const cifHintId = `${dialogId}-cif-hint`;

  const [cif, setCif] = useState(initialCif.toUpperCase());
  const [submitted, setSubmitted] = useState(false);
  const [inputErr, setInputErr] = useState<string | null>(null);
  const [queryErr, setQueryErr] = useState<{ msg: string } | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');

  const cifInputRef = useRef<HTMLInputElement>(null);
  const dialogRef   = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Focus CIF input on open
  useEffect(() => {
    cifInputRef.current?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap within dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', handler);
    return () => dialog.removeEventListener('keydown', handler);
  }, []);

  // Slow-fetch timer: show long-wait message if > 3s
  const [slowFetch, setSlowFetch] = useState(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customer = useQuery({
    queryKey: ['cbs', 'customer', cif],
    queryFn: () => fetchCbsCustomer(cif),
    enabled: submitted && !inputErr,
    retry: false,
  });

  // Start/stop slow-fetch timer based on loading state
  useEffect(() => {
    if (customer.isFetching) {
      setSlowFetch(false);
      slowTimer.current = setTimeout(() => setSlowFetch(true), 3_000);
    } else {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setSlowFetch(false);
    }
    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, [customer.isFetching]);

  // Sync query error to local state + live region
  useEffect(() => {
    if (customer.error) {
      const mapped = mapError(customer.error);
      setQueryErr({ msg: mapped.msg });
      setLiveMsg(mapped.msg);
    } else {
      setQueryErr(null);
    }
  }, [customer.error]);

  // Announce successful load
  useEffect(() => {
    if (customer.data) {
      setLiveMsg(t('cbs.customer_loaded', { name: customer.data.name }));
    }
  }, [customer.data]);

  const invalidate = useMutation({
    mutationFn: () => invalidateCbsCustomerCache(cif),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cbs', 'customer', cif] });
      void qc.invalidateQueries({ queryKey: ['cbs', 'accounts', cif] });
      setLiveMsg(t('cbs.cache_invalidated'));
    },
  });

  const handleLookup = useCallback(() => {
    const err = validateCif(cif);
    setInputErr(err);
    if (err) return;
    setQueryErr(null);
    setAccountsOpen(false);
    setSubmitted(true);
    // If already submitted with same CIF, re-fetch
    void qc.invalidateQueries({ queryKey: ['cbs', 'customer', cif] });
  }, [cif, qc]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLookup();
  };

  const is403 = customer.error instanceof HttpError && customer.error.status === 403;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="cbs-lookup-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-lg rounded-card bg-surface shadow-card"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 id={titleId} className="text-md font-semibold text-ink">
            {t('cbs.lookup_title')}
          </h2>
          <button
            type="button"
            aria-label={t('cbs.close')}
            onClick={onClose}
            className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Aria-live region */}
          <span id={liveId} aria-live="polite" aria-atomic="true" className="sr-only">
            {liveMsg}
          </span>

          {/* 403 — disable everything */}
          {is403 && (
            <div
              data-testid="cbs-error"
              className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger/10 px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <p className="text-xs text-danger">{t('cbs.error_forbidden')}</p>
            </div>
          )}

          {/* CIF input */}
          <div>
            <label htmlFor={`${dialogId}-cif`} className="label">
              {t('cbs.cif_label')}
            </label>
            <input
              ref={cifInputRef}
              id={`${dialogId}-cif`}
              data-testid="cbs-cif-input"
              type="text"
              name="cif"
              value={cif}
              maxLength={64}
              autoComplete="off"
              disabled={is403}
              aria-describedby={`${cifHintId}${inputErr ? ` ${dialogId}-cif-err` : ''}`}
              aria-invalid={inputErr !== null}
              onChange={(e) => {
                setCif(e.target.value.toUpperCase());
                setInputErr(null);
              }}
              onKeyDown={handleKeyDown}
              className={cn(
                'input mt-1',
                inputErr && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
              placeholder={t('cbs.cif_placeholder')}
            />
            <span id={cifHintId} className="mt-0.5 block text-xs text-muted">
              {t('cbs.cif_hint')}
            </span>
            {inputErr && (
              <span
                id={`${dialogId}-cif-err`}
                role="alert"
                className="mt-0.5 block text-xs text-danger"
              >
                {inputErr}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              data-testid="cbs-lookup-submit"
              size="sm"
              onClick={handleLookup}
              loading={customer.isFetching}
              disabled={is403}
            >
              {t('cbs.fetch_button')}
            </Button>

            {canAdmin && customer.data && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => invalidate.mutate()}
                loading={invalidate.isPending}
                aria-label={t('cbs.refresh_label')}
              >
                <RefreshCw size={12} />
                {t('cbs.refresh_button')}
              </Button>
            )}
          </div>

          {/* Slow fetch notice */}
          {slowFetch && customer.isFetching && (
            <p role="status" className="text-xs text-muted">
              {t('cbs.slow_fetch')}
            </p>
          )}

          {/* Query error (non-403) */}
          {queryErr && !is403 && (
            <div
              data-testid="cbs-error"
              className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger/10 px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <div className="flex-1 text-xs text-danger">
                <p>{queryErr.msg}</p>
                {customer.error instanceof HttpError &&
                  [0, 502, 503, 504].includes(customer.error.status) && (
                    <button
                      type="button"
                      className="mt-1 underline hover:no-underline"
                      onClick={handleLookup}
                    >
                      {t('cbs.retry')}
                    </button>
                  )}
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {customer.isFetching && !customer.data && (
            <div className="space-y-3" aria-busy="true" aria-label={t('cbs.loading')}>
              {[80, 60, 60, 40].map((w, i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-divider"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          )}

          {/* Customer data */}
          {customer.data && (
            <div className="space-y-3">
              {/* Stale banner */}
              {customer.data.stale && customer.data.cached_at && (
                <StaleDataBanner since={customer.data.cached_at} />
              )}

              {/* Cached pill */}
              {customer.data.cached && !customer.data.stale && (
                <span className="inline-block rounded-badge border border-border bg-divider px-2 py-0.5 text-2xs text-muted">
                  {t('cbs.cached_pill')}
                </span>
              )}
              {/* We verified customer existed but it might be cached + stale */}
              {customer.data.cached && customer.data.stale && (
                <span
                  data-testid="cbs-customer-cached-pill"
                  className="inline-block rounded-badge border border-border bg-divider px-2 py-0.5 text-2xs text-muted"
                >
                  {t('cbs.cached_pill')}
                </span>
              )}

              {/* Master fields */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                <dt className="text-muted">{t('cbs.field_name')}</dt>
                <dd
                  data-testid="cbs-customer-name"
                  className="font-medium text-ink"
                >
                  {customer.data.name}
                </dd>

                <dt className="text-muted">{t('cbs.field_national_id')}</dt>
                <dd data-testid="cbs-customer-national-id" className="text-ink">
                  {customer.data.national_id ?? t('cbs.not_available')}
                </dd>

                <dt className="text-muted">{t('cbs.field_email')}</dt>
                <dd className="text-ink">{customer.data.email ?? t('cbs.not_available')}</dd>

                <dt className="text-muted">{t('cbs.field_phone')}</dt>
                <dd className="text-ink">{customer.data.phone ?? t('cbs.not_available')}</dd>

                <dt className="text-muted">{t('cbs.field_kyc')}</dt>
                <dd>
                  {customer.data.kyc_status ? (
                    <Badge
                      tone={
                        customer.data.kyc_status.toLowerCase() === 'verified'
                          ? 'success'
                          : 'warning'
                      }
                    >
                      {customer.data.kyc_status}
                    </Badge>
                  ) : (
                    t('cbs.not_available')
                  )}
                </dd>

                <dt className="text-muted">{t('cbs.field_risk_band')}</dt>
                <dd>
                  {customer.data.risk_band ? (
                    <Badge tone={riskConfig[customer.data.risk_band].tone}>
                      {t(riskConfig[customer.data.risk_band].label)}
                    </Badge>
                  ) : (
                    t('cbs.not_available')
                  )}
                </dd>
              </dl>

              {/* Accounts (lazy) */}
              <div className="border-t border-divider pt-3">
                <button
                  type="button"
                  aria-expanded={accountsOpen}
                  aria-controls={`${dialogId}-accounts`}
                  className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                  onClick={() => setAccountsOpen((v) => !v)}
                >
                  {accountsOpen ? (
                    <ChevronDown size={12} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={12} aria-hidden="true" />
                  )}
                  {t('cbs.accounts_toggle')}
                </button>

                {accountsOpen && (
                  <div id={`${dialogId}-accounts`}>
                    <AccountList cif={customer.data.cif} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-divider px-5 py-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cbs.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
