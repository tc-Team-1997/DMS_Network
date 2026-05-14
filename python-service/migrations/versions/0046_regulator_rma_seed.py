"""regulator_reports — seed BT RMA quarterly template (Wave-E1)

Revision ID: 0046_regulator_rma_seed
Revises: 0045_dsar_requests_extend
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa
import json

revision = "0046_regulator_rma_seed"
down_revision = "0045_dsar_requests_extend"
branch_labels = None
depends_on = None

RMA_QUARTERLY_SCHEMA = {
    "frequency": "quarterly",
    "sla_days": 15,
    "filing_format": "RMA-CR-2026",
    "period_options": ["Q1", "Q2", "Q3", "Q4"],
    "controls": [
        {"id": "AML_KYC",        "label": "AML/KYC compliance",                  "evidence_required": ["sar_filings_count", "kyc_refresh_count"]},
        {"id": "CDD",            "label": "Customer Due Diligence",              "evidence_required": ["high_risk_count", "edd_count"]},
        {"id": "RECORD_KEEPING", "label": "Record keeping (7-year retention)",   "evidence_required": ["docs_purged_count", "retention_violations"]},
        {"id": "REPORTING",      "label": "Suspicious transaction reporting",    "evidence_required": ["str_count", "ctr_count"]},
        {"id": "GOVERNANCE",     "label": "Board oversight + MLRO sign-off",     "evidence_required": ["mlro_signoff_date", "board_minutes_link"]},
    ],
}


def upgrade() -> None:
    # INSERT one row keyed by (tenant_id='bhu', regulator='RMA', name=...).
    # ON CONFLICT clause guards against re-runs; explicit DELETE in downgrade.
    op.execute(sa.text("""
        INSERT INTO regulator_reports
          (tenant_id, regulator, name, parameters_schema_json, query_template, format, schedule_cron, is_active)
        VALUES
          ('bhu', 'RMA', 'RMA Quarterly Compliance Report', :schema, '', 'pdf', '0 6 1 1,4,7,10 *', 1)
        ON CONFLICT DO NOTHING
    """).bindparams(schema=json.dumps(RMA_QUARTERLY_SCHEMA)))


def downgrade() -> None:
    op.execute(sa.text("""
        DELETE FROM regulator_reports
        WHERE tenant_id = 'bhu' AND regulator = 'RMA' AND name = 'RMA Quarterly Compliance Report'
    """))
