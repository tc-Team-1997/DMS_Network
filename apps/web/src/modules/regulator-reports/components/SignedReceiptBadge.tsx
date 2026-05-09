/**
 * SignedReceiptBadge — displays a truncated SHA-256 fingerprint and
 * signing metadata from the RSA-PSS detached manifest produced by
 * services/signing.py::sign_detached.
 */
import { ShieldCheck, ShieldOff, Copy } from 'lucide-react';
import { useToast, Tooltip } from '@/components/ui';
import type { SignatureManifest } from '../schemas';

interface Props {
  sha256: string | null | undefined;
  signatureJson: string | null | undefined;
}

function parseManifest(raw: string | null | undefined): SignatureManifest | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'sha256' in parsed &&
      'signed_at' in parsed &&
      'signer' in parsed &&
      'cert_fingerprint_sha256' in parsed &&
      'algorithm' in parsed
    ) {
      return parsed as SignatureManifest;
    }
    return null;
  } catch {
    return null;
  }
}

export function SignedReceiptBadge({ sha256, signatureJson }: Props) {
  const { toast } = useToast();
  const manifest = parseManifest(signatureJson);
  const isSigned = manifest !== null;

  function copyHash() {
    if (!sha256) return;
    void navigator.clipboard.writeText(sha256).then(() =>
      toast({ variant: 'success', title: 'Copied', message: 'SHA-256 copied to clipboard.' }),
    );
  }

  if (!sha256 && !isSigned) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger">
        <ShieldOff size={11} />
        Unsigned
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* SHA-256 fingerprint row */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            isSigned
              ? 'bg-success-bg text-success'
              : 'bg-warning-bg text-warning'
          }`}
        >
          <ShieldCheck size={11} />
          {isSigned ? 'Signed' : 'Hash only'}
        </span>
        {sha256 && (
          <Tooltip content={sha256}>
            <button
              type="button"
              onClick={copyHash}
              className="flex items-center gap-1 rounded border border-divider bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-sub hover:bg-divider focus:outline-none focus:ring-1 focus:ring-brand-blue"
              aria-label="Copy SHA-256"
            >
              {sha256.slice(0, 12)}…
              <Copy size={9} />
            </button>
          </Tooltip>
        )}
      </div>
      {/* Signing detail */}
      {manifest && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[10px] text-muted">
          <dt className="font-medium text-ink-sub">Signer</dt>
          <dd>{manifest.signer}</dd>
          <dt className="font-medium text-ink-sub">Signed</dt>
          <dd>{new Date(manifest.signed_at).toLocaleString()}</dd>
          <dt className="font-medium text-ink-sub">Algorithm</dt>
          <dd>{manifest.algorithm}</dd>
          <dt className="font-medium text-ink-sub">Cert</dt>
          <dd className="truncate font-mono">{manifest.cert_fingerprint_sha256.slice(0, 16)}…</dd>
        </dl>
      )}
    </div>
  );
}
