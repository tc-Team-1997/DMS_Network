/**
 * ActionDrawer — right-side 480px drawer that opens on workflow row click.
 *
 * Sections:
 *   1. Document preview link (PDF.js iframe deferred to Viewer-v2 owner)
 *   2. Audit trail — chronological wf_actions list
 *   3. Action panel — Approve / Reject / Escalate (full-width buttons)
 *   4. Keyboard shortcut legend
 *
 * Keyboard shortcuts (global while drawer is open):
 *   A → open Approve form
 *   R → open Reject form
 *   E → open Escalate form
 *   Esc → close drawer (handled by Drawer primitive)
 *   ? → no-op (legend is always visible)
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer } from '@/components/ui';
import { Badge, statusTone } from '@/components/ui';
import { ExternalLink, CheckCircle, XCircle, ArrowUpCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchWorkflow } from '../api';
import type { WorkflowRow } from '../api';
import { StageTimelinePills } from './StageTimelinePills';
import { ApproveForm } from './ApproveForm';
import { RejectForm } from './RejectForm';
import { EscalateForm } from './EscalateForm';
import { KeyboardShortcutsLegend } from './KeyboardShortcutsLegend';

type ActiveForm = 'approve' | 'reject' | 'escalate' | null;

interface ActionDrawerProps {
  workflow: WorkflowRow | null;
  onClose: () => void;
  canApprove: boolean;
  canEscalate: boolean;
  onActionSuccess: (msg: string) => void;
}

function AuditTrailEntry({
  action,
  actor,
  reasonCode,
  comment,
  createdAt,
}: {
  action: string;
  actor: string | null;
  reasonCode: string | null;
  comment: string | null;
  createdAt: string;
}) {
  const toneMap: Record<string, string> = {
    approve:  'text-success',
    reject:   'text-danger',
    escalate: 'text-warning',
  };
  const tone = toneMap[action] ?? 'text-ink-sub';

  return (
    <div className="flex gap-3 py-2 border-b border-divider last:border-0">
      <div className="mt-0.5 shrink-0">
        {action === 'approve'  && <CheckCircle  size={14} className="text-success" />}
        {action === 'reject'   && <XCircle      size={14} className="text-danger" />}
        {action === 'escalate' && <ArrowUpCircle size={14} className="text-warning" />}
        {action !== 'approve' && action !== 'reject' && action !== 'escalate' && (
          <Clock size={14} className="text-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn('text-xs font-semibold capitalize', tone)}>{action}</span>
          {actor && <span className="text-2xs text-muted">{actor}</span>}
          <span className="ml-auto text-2xs text-muted tabular-nums">
            {new Date(createdAt).toLocaleString()}
          </span>
        </div>
        {reasonCode && (
          <p className="text-2xs text-ink-sub mt-0.5">
            <span className="font-medium">Reason:</span> {reasonCode}
          </p>
        )}
        {comment && (
          <p className="text-2xs text-ink-sub mt-0.5 break-words">{comment}</p>
        )}
      </div>
    </div>
  );
}

export function ActionDrawer({
  workflow,
  onClose,
  canApprove,
  canEscalate,
  onActionSuccess,
}: ActionDrawerProps) {
  const qc = useQueryClient();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);

  const { data: detail } = useQuery({
    queryKey: ['workflow-detail', workflow?.id],
    queryFn: () => fetchWorkflow(workflow!.id),
    enabled: workflow != null,
  });

  const isTerminal = workflow != null && (
    workflow.stage === 'Approved' || workflow.stage.startsWith('Rejected')
  );

  // Keyboard shortcuts while drawer is open.
  useEffect(() => {
    if (!workflow) return;
    const handler = (e: KeyboardEvent) => {
      // Skip if focus is in an input/textarea/select.
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'a' || e.key === 'A') {
        if (canApprove && !isTerminal) setActiveForm('approve');
      } else if (e.key === 'r' || e.key === 'R') {
        if (canApprove && !isTerminal) setActiveForm('reject');
      } else if (e.key === 'e' || e.key === 'E') {
        if (canEscalate && !isTerminal) setActiveForm('escalate');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [workflow, canApprove, canEscalate, isTerminal]);

  // Reset form when workflow changes.
  useEffect(() => {
    setActiveForm(null);
  }, [workflow?.id]);

  function handleSuccess(stage: string) {
    setActiveForm(null);
    void qc.invalidateQueries({ queryKey: ['workflows'] });
    void qc.invalidateQueries({ queryKey: ['workflow-detail', workflow?.id] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
    onActionSuccess(`Workflow moved to ${stage}.`);
  }

  const auditTrail = detail?.audit_trail ?? [];

  return (
    <Drawer
      open={workflow != null}
      onClose={onClose}
      side="right"
      width="480px"
      title={workflow != null ? (
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted">{workflow.ref_code ?? '—'}</span>
          <Badge tone={statusTone(workflow.stage)}>{workflow.stage}</Badge>
        </span>
      ) : undefined}
    >
      {workflow != null && (
        <div className="space-y-5">
          {/* Document preview */}
          {workflow.doc_id != null && (
            <div className="rounded-card border border-divider bg-divider/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{workflow.document_name ?? 'Document'}</span>
                <a
                  href={`/viewer/${workflow.doc_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
                  data-testid="drawer-viewer-link"
                >
                  <ExternalLink size={11} />
                  Open in viewer
                </a>
              </div>
              {workflow.doc_type && (
                <p className="mt-0.5 text-xs text-muted">{workflow.doc_type}</p>
              )}
            </div>
          )}

          {/* Stage timeline */}
          <div>
            <p className="label mb-1.5">Progress</p>
            <StageTimelinePills stage={workflow.stage} />
          </div>

          {/* Workflow meta */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {workflow.customer_name && (
              <div>
                <span className="text-muted">Customer</span>
                <p className="text-ink font-medium">{workflow.customer_name}</p>
              </div>
            )}
            {workflow.branch && (
              <div>
                <span className="text-muted">Branch</span>
                <p className="text-ink font-medium">{workflow.branch}</p>
              </div>
            )}
            {workflow.priority && (
              <div>
                <span className="text-muted">Priority</span>
                <p className="text-ink font-medium">{workflow.priority}</p>
              </div>
            )}
            {workflow.risk_band && (
              <div>
                <span className="text-muted">Risk band</span>
                <p className="text-ink font-medium capitalize">{workflow.risk_band}</p>
              </div>
            )}
          </div>

          {/* Audit trail */}
          <div>
            <p className="label mb-1.5">Audit trail</p>
            {auditTrail.length === 0 ? (
              <p className="text-xs text-muted italic">No actions recorded yet.</p>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-card border border-divider px-3 py-1">
                {auditTrail.map((entry) => (
                  <AuditTrailEntry
                    key={entry.id}
                    action={entry.action}
                    actor={entry.actor_name ?? entry.actor_username}
                    reasonCode={entry.reason_code}
                    comment={entry.comment}
                    createdAt={entry.created_at}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action panel */}
          {!isTerminal && (
            <div className="space-y-3">
              <p className="label">Actions</p>

              {activeForm === null && (
                <div className="flex flex-col gap-2">
                  {canApprove && (
                    <button
                      type="button"
                      onClick={() => setActiveForm('approve')}
                      data-testid="drawer-approve-btn"
                      className="w-full rounded-input border border-success/40 bg-success-bg py-2 text-sm font-medium text-success hover:bg-success/10 transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={14} />
                      Approve
                    </button>
                  )}
                  {canApprove && (
                    <button
                      type="button"
                      onClick={() => setActiveForm('reject')}
                      data-testid="drawer-reject-btn"
                      className="w-full rounded-input border border-danger/40 bg-danger-bg py-2 text-sm font-medium text-danger hover:bg-danger/10 transition-colors flex items-center justify-center gap-2"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  )}
                  {canEscalate && (
                    <button
                      type="button"
                      onClick={() => setActiveForm('escalate')}
                      data-testid="drawer-escalate-btn"
                      className="w-full rounded-input border border-warning/40 bg-warning-bg py-2 text-sm font-medium text-warning hover:bg-warning/10 transition-colors flex items-center justify-center gap-2"
                    >
                      <ArrowUpCircle size={14} />
                      Escalate
                    </button>
                  )}
                </div>
              )}

              {activeForm === 'approve' && (
                <ApproveForm
                  workflow={workflow}
                  onSuccess={handleSuccess}
                  onCancel={() => setActiveForm(null)}
                />
              )}
              {activeForm === 'reject' && (
                <RejectForm
                  workflow={workflow}
                  onSuccess={handleSuccess}
                  onCancel={() => setActiveForm(null)}
                />
              )}
              {activeForm === 'escalate' && (
                <EscalateForm
                  workflow={workflow}
                  onSuccess={handleSuccess}
                  onCancel={() => setActiveForm(null)}
                />
              )}
            </div>
          )}

          {/* Keyboard shortcuts */}
          <div className="pt-2 border-t border-divider">
            <p className="label mb-1.5">Keyboard shortcuts</p>
            <KeyboardShortcutsLegend />
          </div>
        </div>
      )}
    </Drawer>
  );
}
