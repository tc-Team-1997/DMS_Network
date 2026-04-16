"""PAdES (PDF Advanced Electronic Signatures) via pyhanko.

Gracefully degrades to the simpler detached signer in signing.py if pyhanko / its
deps aren't installed. For eIDAS-level assurance you need:
  - a CA-issued signing cert (replace the self-signed one in storage/keys/)
  - a TSA (Timestamp Authority) URL reachable at signing time
  - validation info (AIA/CRL/OCSP) embedded → pyhanko handles this when `use_pades_lta=True`
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

from .signing import KEY_PATH, CERT_PATH, _ensure_cert


def sign_pdf_pades(
    pdf_path: str,
    signer_name: str,
    reason: str = "Approved",
    location: str = "NBE DMS",
    tsa_url: Optional[str] = None,
    field_name: str = "NBE-Signature-1",
) -> dict:
    """Produce a PAdES-B-LT / PAdES-B-T signature inside the PDF."""
    _ensure_cert()
    p = Path(pdf_path)
    if p.suffix.lower() != ".pdf":
        return {"ok": False, "reason": "not a PDF"}

    try:
        from pyhanko.sign import signers, fields, timestamps
        from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata, PdfSigner
        from pyhanko_certvalidator import ValidationContext
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    except Exception as e:
        return {"ok": False, "reason": f"pyhanko not available: {e}"}

    signer = signers.SimpleSigner.load(
        key_file=str(KEY_PATH),
        cert_file=str(CERT_PATH),
        ca_chain_files=(str(CERT_PATH),),
    )

    timestamper = timestamps.HTTPTimeStamper(tsa_url) if tsa_url else None

    out = p.with_name(p.stem + ".pades.pdf")
    with open(p, "rb") as inf, open(out, "wb") as outf:
        w = IncrementalPdfFileWriter(inf)
        fields.append_signature_field(w, sig_field_spec=fields.SigFieldSpec(sig_field_name=field_name))
        meta = PdfSignatureMetadata(
            field_name=field_name,
            reason=reason,
            location=location,
            name=signer_name,
            subfilter=signers.SigSeedSubFilter.PADES,
            validation_context=ValidationContext(allow_fetching=False),
            use_pades_lta=bool(timestamper),
        )
        pdf_signer = PdfSigner(meta, signer=signer, timestamper=timestamper)
        pdf_signer.sign_pdf(w, output=outf)

    return {
        "ok": True,
        "output": str(out),
        "profile": "PAdES-B-LT" if timestamper else "PAdES-B-B",
        "field_name": field_name,
    }
