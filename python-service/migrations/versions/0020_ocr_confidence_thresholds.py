"""Add OCR confidence threshold columns to document_type_schemas.

Adds three nullable columns to ``document_type_schemas``:

  autofill_floor           FLOAT   — lower confidence bound; fields at or above
                                     this value are auto-filled without review.
                                     Defaults to 0.4.

  high_confidence          FLOAT   — upper confidence bound; fields at or above
                                     this value are shown to the user as high-
                                     confidence extractions.  Defaults to 0.7.

  tested_with_sample_id    INTEGER — FK to document_type_samples(id).  Records
                                     which sample document was used when the Doc
                                     Admin last tested / tuned these thresholds.
                                     ON DELETE SET NULL — deleting the sample
                                     does not cascade to the schema row.

All three columns are nullable so existing rows are unaffected (backwards-
compatible per the migration policy).  Defaults align with the contract spec
(docs/contracts/ocr-confidence-tuning.md §7).

Revision ID: 0020_ocr_confidence_thresholds
Revises: 0019_customers
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_ocr_confidence_thresholds"
down_revision = "0019_customers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # autofill_floor — confidence floor for auto-fill (0–1 scale, default 0.4).
    op.add_column(
        "document_type_schemas",
        sa.Column(
            "autofill_floor",
            sa.Float,
            nullable=True,
            server_default="0.4",
        ),
    )

    # high_confidence — confidence threshold for "review required" band (0–1 scale, default 0.7).
    op.add_column(
        "document_type_schemas",
        sa.Column(
            "high_confidence",
            sa.Float,
            nullable=True,
            server_default="0.7",
        ),
    )

    # tested_with_sample_id — FK to document_type_samples; nullable, ON DELETE SET NULL.
    op.add_column(
        "document_type_schemas",
        sa.Column(
            "tested_with_sample_id",
            sa.Integer,
            sa.ForeignKey("document_type_samples.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Index the FK so the JOIN in the Thresholds tab preview does not table-scan.
    op.create_index(
        "idx_doctype_schemas_tested_sample",
        "document_type_schemas",
        ["tested_with_sample_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_doctype_schemas_tested_sample", table_name="document_type_schemas")
    op.drop_column("document_type_schemas", "tested_with_sample_id")
    op.drop_column("document_type_schemas", "high_confidence")
    op.drop_column("document_type_schemas", "autofill_floor")
