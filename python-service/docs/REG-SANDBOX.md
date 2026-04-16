# CBE Regulatory Sandbox — Submission Pack

Reference pack for applying to the **Central Bank of Egypt FinTech & Innovation
Regulatory Sandbox** (Regulation No. 22/2022) with the NBE DMS stack.

## 1. Cover brief (1 page)

- **Innovation**: AI-assisted document lifecycle management with on-chain
  anchoring, federated fraud learning, and zero-knowledge KYC proofs.
- **Target users**: NBE branches, NBE customers (portal), partner fintechs
  (OIDC / verifiable KYC claims).
- **Problem solved**: weeks-long manual KYC refresh cycles; duplicated customer
  files across branches; AML false-positive tuning without cross-branch data
  sharing.
- **Sandbox phase requested**: Cohort ingress → limited live pilot
  (2,000 customers / Cairo West + Giza / 90 days).
- **Risk envelope**: maximum 5,000 documents processed, no new account
  openings via the sandbox, no outbound payments.

## 2. Artifacts included in this repo

| Requirement                          | Artifact                                                         |
|--------------------------------------|-------------------------------------------------------------------|
| Architecture diagram                 | [SLOs.md](./SLOs.md) + [DR-RUNBOOK.md](./DR-RUNBOOK.md)            |
| Data-protection impact assessment    | Generated via `/api/v1/lineage` (OpenLineage JSON export)         |
| Penetration-test scope               | [services/waf.py](../app/services/waf.py) rules + k8s NetworkPolicy |
| Operational runbook                  | [runbooks/dms-availability.md](./runbooks/dms-availability.md)     |
| Incident DR                          | [DR-RUNBOOK.md](./DR-RUNBOOK.md)                                   |
| Encryption at rest                   | [services/encryption.py](../app/services/encryption.py) + tenant isolation |
| AML screening                        | OFAC/UN watchlist sync, auto-rematch, `/api/v1/watchlist/*`        |
| Audit log retention ≥ 7 years        | retention policies + `LEDGER_*` immutable export                   |
| Customer consent (DSAR)              | `/api/v1/dsar/{export,erase}/{cid}`                                |
| Supply-chain provenance              | SLSA L3 + cosign attestations (`.github/workflows/supply-chain.yml`) |
| BCMS / BCP                           | DR runbook + cross-region Terraform (`terraform/dr.tf`)            |

## 3. Cohort entry checklist (self-attestation)

Run this script to verify every mandatory control is wired up before submission:

```bash
python scripts/regsandbox_checklist.py
```

It probes the live service and emits a JSON report listing each CBE control
and the evidence URL / endpoint confirming it is in place. Commit the report
alongside your application.

## 4. Exit criteria

Cohort graduates when **all** of:

- ≥ 99.5% availability over the pilot window (from Prometheus SLO board)
- 0 critical security findings from the CBE Cyber team's review
- Successful quarterly DR drill during the sandbox window
- No unresolved `aml.alert` events older than 5 business days
- All DSAR requests fulfilled within the statutory 30-day window

## 5. Regulator access

CBE Supervisors receive a read-only OIDC client (`cli_cbe_supervisor`) scoped to
`openid profile email audit:read`. Issue via:

```bash
curl -X POST http://dms.nbe.local/oidc/clients \
  -F "name=CBE Supervisor (sandbox cohort 2026)" \
  -F "redirect_uri=https://cbe.gov.eg/sso/callback" \
  -F "scopes=openid profile email audit:read"
```

Store the returned `client_secret` in a vault accessible only to the CBE
liaison officer.
