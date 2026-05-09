/**
 * AccountsTab — list of customer accounts (paginated).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchAccounts } from '../api';

interface AccountsTabProps {
  cid: string;
}

const PAGE = 20;

const STATUS_CLASS: Record<string, string> = {
  active:   'bg-success-bg text-success',
  inactive: 'bg-divider text-ink-sub',
  closed:   'bg-danger-bg text-danger',
};

export function AccountsTab({ cid }: AccountsTabProps) {
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['customer360', cid, 'accounts', offset],
    queryFn:  () => fetchAccounts(cid, { limit: PAGE, offset }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true" aria-label={t('customer360.loading')}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-12 rounded-card bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center gap-2">
        <AlertTriangle size={13} aria-hidden="true" />
        {t('customer360.error_load')}
      </div>
    );
  }

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  if (items.length === 0) {
    return <p className="text-xs text-muted italic py-4 text-center">{t('customer360.accounts_empty')}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((account) => (
        <div
          key={account.account_id}
          className="rounded-card border border-divider bg-surface px-3 py-2 space-y-1"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-xs text-ink font-medium">{account.account_id}</span>
            {account.status && (
              <span
                className={cn(
                  'rounded-badge px-1.5 py-0.5 text-2xs font-semibold capitalize shrink-0',
                  STATUS_CLASS[account.status.toLowerCase()] ?? 'bg-divider text-ink-sub',
                )}
              >
                {account.status}
              </span>
            )}
          </div>
          <div className="flex gap-4 text-2xs text-muted flex-wrap">
            {account.account_type && <span>{account.account_type}</span>}
            {account.currency && <span>{account.currency}</span>}
            {account.balance !== null && (
              <span className="font-mono text-ink">
                {account.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            )}
            {account.opened_date && (
              <span>{t('customer360.opened')}: {new Date(account.opened_date).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      ))}

      {total > PAGE && (
        <div className="flex justify-between items-center pt-1">
          <Button
            type="button" size="sm" variant="ghost"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            {t('customer360.prev')}
          </Button>
          <span className="text-2xs text-muted">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
          <Button
            type="button" size="sm" variant="ghost"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            {t('customer360.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
