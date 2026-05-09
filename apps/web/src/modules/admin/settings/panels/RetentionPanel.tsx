/**
 * RetentionPanel — stub panel in Admin Settings that forwards to the
 * full Retention + WORM admin page at /admin/retention.
 *
 * The detailed retention configuration (per-doctype rules, legal holds, WORM
 * admin, purge log) lives at /admin/retention as a full-page module. The
 * /admin/settings/retention path surfaces a quick-access card and the
 * namespace-level config (sweep schedule, default delete policy, etc.) via
 * the generic ConfigPanel for the 'retention' namespace.
 */
import { Link } from 'react-router-dom';
import { Archive, ArrowRight } from 'lucide-react';
import { ConfigPanel } from '../ConfigPanel';

export function RetentionPanel() {
  return (
    <div className="space-y-6">
      {/* Quick-access banner */}
      <Link
        to="/admin/retention"
        className="flex items-center justify-between rounded-card border border-brand-skyLight bg-brand-skyLight/40 px-4 py-3 text-sm text-brand-blue hover:bg-brand-skyLight transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue"
        data-testid="retention-panel-link"
      >
        <span className="flex items-center gap-2 font-medium">
          <Archive size={15} />
          Manage per-doctype rules, legal holds &amp; WORM admin
        </span>
        <ArrowRight size={15} />
      </Link>

      {/* Global retention namespace settings via generic ConfigPanel */}
      <ConfigPanel
        namespace="retention"
        title="Retention settings"
        description="Global retention configuration — sweep schedule, default delete policy, and alert thresholds. Per-doctype rules are managed on the Retention admin page."
      />
    </div>
  );
}
