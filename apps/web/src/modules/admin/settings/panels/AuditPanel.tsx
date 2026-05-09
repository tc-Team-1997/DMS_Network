import { ConfigPanel } from '../ConfigPanel';

/**
 * AuditPanel — admin settings panel for the audit_log namespace.
 *
 * Schema: schemas/tenant-config/audit_log.json (published in Wave C, migration 0038).
 * Keys: retention_days, anchor_schedule_cron, export_formats_enabled,
 *       default_filter_set_per_role, fts_enabled, verify_chain_window.
 *
 * RBAC: Doc Admin only (requireNamespacePermJson 'write' on the backend).
 */
export function AuditPanel() {
  return (
    <ConfigPanel
      namespace="audit_log"
      title="Audit log"
      description="Configure audit log retention, FTS search, hash-chain verification window, OTS anchor schedule, and allowed export formats."
    />
  );
}
