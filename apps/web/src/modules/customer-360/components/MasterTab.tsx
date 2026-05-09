/**
 * MasterTab — 9-attribute customer header card.
 *
 * Non-PII fields (CID, Branch, Risk band, KYC status, AML status, Onboarded)
 * are shown directly.  PII fields (National ID, DOB, Phone, Email) are shown
 * masked with PiiRevealField which can be individually revealed.
 */

import { AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { Customer360Header } from '../schemas';
import { PiiRevealField } from './PiiRevealField';

interface MasterTabProps {
  header: Customer360Header;
  cid:    string;
}

const RISK_BAND_CLASS: Record<string, string> = {
  low:    'bg-success-bg text-success',
  medium: 'bg-warning-bg text-warning',
  high:   'bg-danger-bg text-danger',
};

const KYC_STATUS_CLASS: Record<string, string> = {
  approved: 'bg-success-bg text-success',
  pending:  'bg-warning-bg text-warning',
  rejected: 'bg-danger-bg text-danger',
};

const AML_STATUS_CLASS: Record<string, string> = {
  cleared:   'bg-success-bg text-success',
  flagged:   'bg-danger-bg text-danger',
  escalated: 'bg-warning-bg text-warning',
  open:      'bg-divider text-ink-sub',
};

function StatusBadge({ value, classMap }: { value: string | null; classMap: Record<string, string> }) {
  if (!value) return <span className="text-muted text-xs">—</span>;
  const cls = classMap[value.toLowerCase()] ?? 'bg-divider text-ink-sub';
  return (
    <span className={cn('inline-block rounded-badge px-1.5 py-0.5 text-2xs font-semibold capitalize', cls)}>
      {value}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-2 border-b border-divider last:border-b-0">
      <dt className="text-xs text-muted font-medium shrink-0">{label}</dt>
      <dd className="text-xs text-ink text-right font-mono min-w-0 truncate">
        {children}
      </dd>
    </div>
  );
}

export function MasterTab({ header, cid }: MasterTabProps) {
  return (
    <dl className="space-y-0">
      <Row label={t('customer360.attr_cid')}>
        <span className="text-brand-blue font-semibold">{header.cid}</span>
      </Row>

      {/* PII fields — individually revealable */}
      <div className="py-2 border-b border-divider">
        <PiiRevealField
          field="national_id"
          maskedValue={header.national_id}
          cid={cid}
          label={t('customer360.attr_national_id')}
        />
      </div>

      <div className="py-2 border-b border-divider">
        <PiiRevealField
          field="dob"
          maskedValue={header.dob}
          cid={cid}
          label={t('customer360.attr_dob')}
        />
      </div>

      <div className="py-2 border-b border-divider">
        <PiiRevealField
          field="phone"
          maskedValue={header.phone}
          cid={cid}
          label={t('customer360.attr_phone')}
        />
      </div>

      <div className="py-2 border-b border-divider">
        <PiiRevealField
          field="email"
          maskedValue={header.email}
          cid={cid}
          label={t('customer360.attr_email')}
        />
      </div>

      <Row label={t('customer360.attr_branch')}>
        {header.branch ?? '—'}
      </Row>

      <Row label={t('customer360.attr_risk_band')}>
        {header.risk_band ? (
          <span className="flex items-center gap-1 justify-end">
            {header.risk_band === 'high' && (
              <AlertTriangle size={10} className="text-danger" aria-hidden="true" />
            )}
            <StatusBadge value={header.risk_band} classMap={RISK_BAND_CLASS} />
          </span>
        ) : '—'}
      </Row>

      <Row label={t('customer360.attr_kyc_status')}>
        <StatusBadge value={header.kyc_status} classMap={KYC_STATUS_CLASS} />
      </Row>

      <Row label={t('customer360.attr_aml_status')}>
        <StatusBadge value={header.aml_status} classMap={AML_STATUS_CLASS} />
      </Row>

      <Row label={t('customer360.attr_onboarded')}>
        {header.onboarded_date
          ? new Date(header.onboarded_date).toLocaleDateString()
          : '—'}
      </Row>
    </dl>
  );
}
