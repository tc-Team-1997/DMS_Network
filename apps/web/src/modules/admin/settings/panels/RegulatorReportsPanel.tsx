/**
 * RegulatorReportsPanel — Admin Settings panel for the regulator_reports
 * namespace. Surfaces the generic ConfigPanel (uses the JSON Schema at
 * schemas/tenant-config/regulator_reports.json). Includes a quick-access
 * link to the full Regulator Reports library page.
 *
 * Keys surfaced:
 *   seeded_regulators          – display-only list of installed regulators
 *   signed_receipt_required    – bool
 *   auto_submit_enabled        – bool
 *   default_format             – pdf | csv | jsonld
 *   pre_flight_checks_enabled  – bool
 *   retention_days_for_submissions – integer (default 2555 = 7 years)
 *   webhook_token              – string (bearer token for stub submission)
 *
 * Placed in the new "Compliance & Privacy" group in SettingsLayout.
 */
import { Link } from 'react-router-dom';
import { FileSpreadsheet, ArrowRight } from 'lucide-react';
import { ConfigPanel } from '../ConfigPanel';

export function RegulatorReportsPanel() {
  return (
    <div className="space-y-6">
      {/* Quick-access banner to the full library page */}
      <Link
        to="/regulator-reports"
        className="flex items-center justify-between rounded-card border border-brand-skyLight bg-brand-skyLight/40 px-4 py-3 text-sm text-brand-blue hover:bg-brand-skyLight transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue"
        data-testid="regulator-reports-panel-link"
      >
        <span className="flex items-center gap-2 font-medium">
          <FileSpreadsheet size={15} />
          Open the Regulator Reports library
        </span>
        <ArrowRight size={15} />
      </Link>

      {/* Namespace settings via generic ConfigPanel */}
      <ConfigPanel
        namespace="regulator_reports"
        title="Regulator Reports settings"
        description="Configure report signing requirements, auto-submit behaviour, default format, and submission retention. The webhook_token is sent as a Bearer token when auto_submit_enabled is true."
      />
    </div>
  );
}
