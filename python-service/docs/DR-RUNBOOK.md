# NBE DMS — Disaster Recovery Runbook

**Scope**: Python microservice + Postgres metadata + S3 document store + Redis queue.
**RPO target**: ≤ 15 min · **RTO target**: ≤ 30 min · **Drill cadence**: quarterly.

---

## 1. Topology

| Component         | Primary (eu-west-1)            | DR (eu-central-1)                 | Replication                     |
|-------------------|--------------------------------|-----------------------------------|---------------------------------|
| EKS cluster       | `nbe-dms-prod-eks`             | `nbe-dms-prod-eks-dr` (pilot)     | GitOps — ArgoCD, same manifests |
| RDS Postgres 16   | `nbe-dms-prod-db`              | `nbe-dms-prod-db-dr` (replica)    | Cross-region read replica       |
| S3 documents      | `nbe-dms-prod-docs-<hex>`      | `…-docs-dr-<hex>`                 | Cross-region replication        |
| ElastiCache Redis | `nbe-dms-prod-redis`           | Rebuilt on failover               | N/A (ephemeral queue)           |
| Secrets           | Secrets Manager eu-west-1      | Replica in eu-central-1           | Automatic via replica config    |

Provisioned via [terraform/dr.tf](../terraform/dr.tf).

---

## 2. Indicators that trigger DR

Any of:
- Primary region AWS status = Major Service Event for ≥ 15 min on EKS, RDS, or S3
- Synthetic probe `GET /health` failure from 2 external regions for ≥ 10 min
- RDS primary unrecoverable (storage full / corruption / ransomware)
- Intentional drill (scheduled)

Call it via the on-call bridge. DR commander is **Head of Infrastructure**; backup is **CTO**.

---

## 3. Failover procedure (aim: 30 min)

### T+0 — Declare and freeze
- [ ] Page `#dms-oncall` Slack channel; start incident Zoom
- [ ] Update status page → "Investigating"
- [ ] **Freeze writes**: `kubectl scale deploy/dms-nbe-dms --replicas=0 -n nbe-dms` (primary region)
- [ ] Confirm last successful backup timestamp in RDS console

### T+5 — Promote database
- [ ] In eu-central-1 RDS console: **Promote** `nbe-dms-prod-db-dr` → standalone primary
- [ ] Verify: `psql -h <new-primary> -c 'SELECT now();'`
- [ ] Capture new endpoint → update Secrets Manager `APP_DATABASE_URL` in DR region

### T+10 — Switch document store
- [ ] S3 replication is async — verify DR bucket has latest objects:
      `aws s3 ls s3://<dr-bucket>/ --recursive | tail`
- [ ] If app reads from S3 via env `STORAGE_S3_BUCKET`, update it to DR bucket name

### T+15 — Deploy app in DR
- [ ] `aws eks update-kubeconfig --region eu-central-1 --name nbe-dms-prod-eks-dr`
- [ ] `helm upgrade --install dms ./helm/nbe-dms -n nbe-dms --create-namespace \`
      `  --set image.tag=<last-known-good>` \
      `  --set secrets.DATABASE_URL=$NEW_DB_URL \`
      `  --set env.STORAGE_S3_BUCKET=<dr-bucket>`
- [ ] `kubectl rollout status deploy/dms-nbe-dms -n nbe-dms --timeout=10m`

### T+20 — DNS switch
- [ ] Route 53 weighted record `dms.nbe.local` → shift 100% to DR ALB
- [ ] Confirm `curl https://dms.nbe.local/health` returns 200 from DR
- [ ] Flush CDN / Cloudflare cache if applicable

### T+25 — Validate
- [ ] Log in as `ahmed.m / demo` → Dashboard loads → KPIs non-zero
- [ ] Upload a 1-page PDF → appears in Repository
- [ ] Enqueue `ocr.process` → task completes
- [ ] Verify Prometheus scrape works on DR → Grafana shows live metrics

### T+30 — Communicate
- [ ] Status page → "DR active — performance may be degraded"
- [ ] Email stakeholders from the template in `/docs/dr/email-template.md`
- [ ] Open post-incident issue in `incidents/` repo with timestamps

---

## 4. Failback (when primary region is healthy)

1. Reverse RDS replication: take snapshot of DR primary → restore in eu-west-1
2. Re-enable S3 replication: primary (eu-west-1) ← DR (eu-central-1) temporarily
3. Put app in maintenance mode for ~ 5 min; scale DR to 0 replicas
4. Shift Route 53 back to primary
5. Resume normal replication direction, confirm RPO is back in target

---

## 5. Quarterly drill checklist

Target duration: 90 minutes, non-production-impacting.

- [ ] **Week -2**: announce drill window to stakeholders, confirm no release freezes
- [ ] **Day 0**: run failover procedure against **staging** environment only
- [ ] Capture real RPO (last replicated LSN) and RTO (T+0 → T+25)
- [ ] File discrepancies from this runbook as PRs
- [ ] Failback to staging primary
- [ ] Archive drill artifacts (logs, screenshots) in SharePoint `DMS/DR/Drills/YYYY-QN`
- [ ] Update [this runbook](./DR-RUNBOOK.md) — bump "last drill" date below

**Last drill**: _n/a — populate after first exercise_

---

## 6. Data-loss bounds

| Data                | Max acceptable loss | Mechanism                   |
|---------------------|---------------------|-----------------------------|
| Uploaded documents  | 15 min              | S3 CRR (async)              |
| Metadata (RDS)      | 5 min (binlog lag)  | Read-replica streaming      |
| OCR output          | 15 min              | Persisted in RDS + S3       |
| Background tasks    | may re-run          | Idempotent handlers required|
| Audit log local     | 0 (tail-synced)     | SIEM buffer + local jsonl   |

Anything the customer would see as lost work (uploads, workflow actions within the last 15 min)
must be communicated in the DR activation notice.
