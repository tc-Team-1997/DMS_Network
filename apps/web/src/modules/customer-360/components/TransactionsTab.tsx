/**
 * TransactionsTab — paginated list of customer transactions.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchTransactions } from '../api';

interface TransactionsTabProps {
  cid: string;
}

const PAGE = 20;

export function TransactionsTab({ cid }: TransactionsTabProps) {
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['customer360', cid, 'transactions', offset],
    queryFn:  () => fetchTransactions(cid, { limit: PAGE, offset }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true" aria-label={t('customer360.loading')}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-10 rounded-card bg-divider animate-pulse" />
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
    return <p className="text-xs text-muted italic py-4 text-center">{t('customer360.transactions_empty')}</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((tx, i) => {
        const isCredit = tx.direction === 'credit';
        return (
          <div
            key={tx.tx_ref ?? i}
            className="flex items-start justify-between gap-2 rounded-card border border-divider bg-surface px-3 py-2"
          >
            <div className="flex items-start gap-2 min-w-0">
              {tx.direction ? (
                isCredit
                  ? <ArrowDownLeft size={13} className="text-success shrink-0 mt-0.5" aria-label="credit" />
                  : <ArrowUpRight size={13} className="text-danger shrink-0 mt-0.5" aria-label="debit" />
              ) : null}
              <div className="min-w-0">
                <p className="text-xs text-ink font-mono truncate">{tx.tx_ref}</p>
                <p className="text-2xs text-muted">
                  {tx.tx_type ?? '—'}
                  {tx.tx_date && ` · ${new Date(tx.tx_date).toLocaleDateString()}`}
                </p>
              </div>
            </div>

            {tx.amount !== null && (
              <span
                className={cn(
                  'text-xs font-mono font-semibold shrink-0',
                  isCredit ? 'text-success' : 'text-danger',
                )}
              >
                {isCredit ? '+' : '-'}
                {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {tx.currency ? ` ${tx.currency}` : ''}
              </span>
            )}
          </div>
        );
      })}

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
