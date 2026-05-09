"""LocalParquetBi — delegates to services/etl.py for BI dataset export.

Wraps export_parquet_if_available() and export_documents_csv() from the existing
ETL module. When pandas/pyarrow are not installed, the ETL module falls back to
CSV; this provider transparently delegates whichever path succeeds.

Dataset names: 'fact_documents', 'fact_workflow_steps'.
Unknown dataset names log a warning and raise ValueError.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from ...providers_base import BiProvider

log = logging.getLogger(__name__)

_SUPPORTED_DATASETS = {"fact_documents", "fact_workflow_steps"}


class LocalParquetBi(BiProvider):
    """BI export provider backed by the existing ETL service.

    Delegates to app.services.etl which writes Parquet files when pandas +
    pyarrow are available, or CSV files as a fallback. The returned Path points
    to whichever file was produced.

    The 'since' argument is accepted for interface compatibility but is not
    currently propagated to the ETL layer (which exports the full dataset).
    Incremental export is deferred to a future ETL enhancement.
    """

    def __init__(self, db=None, tenant_id: str = "default") -> None:
        self._db = db
        self._tenant_id = tenant_id

    def export_dataset(
        self,
        dataset: str,
        *,
        since: Optional[datetime] = None,
    ) -> Path:
        """Export a named BI dataset to a local file.

        Args:
            dataset: 'fact_documents' or 'fact_workflow_steps'.
            since:   Accepted but ignored in this implementation (full export).
                     Incremental export is deferred; log a warning when set.

        Returns:
            Path to the exported Parquet or CSV file.

        Raises:
            ValueError: if *dataset* is not a recognised name.
            RuntimeError: if the ETL service fails.
        """
        if dataset not in _SUPPORTED_DATASETS:
            raise ValueError(
                f"Unknown dataset {dataset!r}. "
                f"Supported datasets: {sorted(_SUPPORTED_DATASETS)}"
            )

        if since is not None:
            log.warning(
                "LocalParquetBi.export_dataset: 'since' parameter is not "
                "yet implemented — exporting full dataset for %r.", dataset
            )

        if self._db is None:
            raise RuntimeError(
                "LocalParquetBi requires a database session (db) to run exports."
            )

        try:
            from app.services.etl import (
                export_parquet_if_available,
                export_documents_csv,
                export_workflow_csv,
                create_semantic_views,
            )
        except ImportError as exc:
            raise RuntimeError("ETL service is not available") from exc

        # Ensure views exist before attempting Parquet export.
        try:
            create_semantic_views()
        except Exception as exc:
            log.warning("LocalParquetBi: could not create semantic views: %s", exc)

        # Try Parquet first.
        parquet_paths = export_parquet_if_available(self._db)
        for p in parquet_paths:
            if dataset in p.name:
                return p

        # Fall back to CSV.
        if dataset == "fact_documents":
            return export_documents_csv(self._db)
        elif dataset == "fact_workflow_steps":
            return export_workflow_csv(self._db)

        # Unreachable given the _SUPPORTED_DATASETS guard above.
        raise RuntimeError(f"Export failed for dataset {dataset!r}")
