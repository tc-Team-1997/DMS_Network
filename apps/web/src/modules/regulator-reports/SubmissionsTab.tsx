/**
 * SubmissionsTab — shows the submission log for a single template,
 * or all templates when templateId is undefined (used from Page.tsx global log).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, RefreshCw } from 'lucide-react';
import { DataTable, Badge, Button, EmptyState, Skeleton, useToast, type Column } from '@/components/ui';
import { fetchSubmissions, submitToRegulator } from './api';
import { SignedReceiptBadge } from './components/SignedReceiptBadge';
import type { Submission } from './schemas';

interface Props {
  templateId?: number;
}

export function SubmissionsTab({ templateId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['regulator-reports', 'submissions', templateId, offset],
    queryFn: () => {
      const opts: { template_id?: number; limit?: number; offset?: number } = { limit, offset };
      if (templateId !== undefined) opts.template_id = templateId;
      return fetchSubmissions(opts);
    },
  });

  const submit = useMutation({
    mutationFn: (receiptId: number) => submitToRegulator(receiptId),
    onSuccess: (resp) => {
      toast({
        variant: 'success',
        title: 'Submitted (stub)',
        message: `Receipt #${resp.receipt_id}: ${resp.note ?? 'Recorded.'}`,
      });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'submissions'] });
    },
    onError: (err) => {
      toast({ variant: 'error', title: 'Submit failed', message: String(err) });
    },
  });

  const submissions = data?.submissions ?? [];

  const columns: Column<Submission>[] = [
    {
      key: 'when',
      header: 'Generated',
      width: 155,
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-sm text-ink">{new Date(r.generated_at).toLocaleString()}</span>
          <span className="text-xs text-muted">{r.generated_by ?? 'system'}</span>
        </div>
      ),
    },
    {
      key: 'template',
      header: 'Template',
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-ink">{r.template_name}</span>
          <Badge tone="neutral">{r.regulator}</Badge>
        </div>
      ),
    },
    {
      key: 'receipt',
      header: 'Signed receipt',
      width: 220,
      render: (r) => (
        <SignedReceiptBadge sha256={r.sha256} signatureJson={r.signature} />
      ),
    },
    {
      key: 'submit_status',
      header: 'Submission',
      width: 160,
      render: (r) => {
        if (r.submitted_at) {
          return (
            <div className="flex flex-col gap-0.5">
              <Badge tone={r.response_code === 202 || r.response_code === 200 ? 'success' : 'danger'}>
                HTTP {r.response_code ?? '?'}
              </Badge>
              <span className="text-[10px] text-muted truncate max-w-[140px]">
                {r.regulator_endpoint}
              </span>
            </div>
          );
        }
        return (
          <Button
            size="sm"
            variant="ghost"
            disabled={submit.isPending}
            onClick={() => submit.mutate(r.id)}
          >
            <Send size={12} className="mr-1" />
            Submit stub
          </Button>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<RefreshCw size={24} className="text-muted" />}
        title="Could not load submissions"
        body="Check the API connection."
      />
    );
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={<Send size={24} className="text-muted" />}
        title="No submissions yet"
        body="Generate a report to create the first receipt."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DataTable columns={columns} data={submissions} />
      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted">Showing {offset + 1}–{offset + submissions.length}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <Button size="sm" variant="ghost" disabled={submissions.length < limit} onClick={() => setOffset(offset + limit)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
