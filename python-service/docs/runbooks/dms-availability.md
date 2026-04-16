# Runbook — DMS Availability Error Budget Burn

**Paged via**: `DmsAvailabilityFastBurn` or `DmsAvailabilitySlowBurn`
**SLO**: 99.9% non-5xx over 28 days (40.3 min budget)

## 0. Acknowledge (under 2 min)

Ack in PagerDuty and in `#dms-incident`. Post the current burn rate
(`job:dms_error_ratio:ratio_rate1h`).

## 1. Triage (under 10 min)

Open the Grafana dashboard **NBE DMS — Python Service**. Check:

- [ ] Which endpoint is spiking 5xx? (`sum by (path)(rate(dms_http_requests_total{status=~"5.."}[5m]))`)
- [ ] Which pod? (`kube_pod_status_phase`)
- [ ] Database latency? (`pg_stat_activity` / RDS dashboard)
- [ ] Any recent deploy? `kubectl rollout history deploy/dms-python -n nbe-dms`

## 2. Common causes and fixes

| Symptom                                      | Likely cause                 | Action                                               |
|----------------------------------------------|------------------------------|------------------------------------------------------|
| 5xx on `POST /api/v1/documents`              | S3 / storage PVC full        | Expand PVC or failover to DR S3; purge orphaned temp |
| 5xx on `POST /api/v1/ocr/*`                  | Tesseract OOM-killed         | Scale HPA up; reduce OCR batch size                  |
| 5xx on `POST /api/v1/integrations/call`      | CBS / AML upstream down      | Toggle integration circuit-breaker via admin API     |
| Spike at 00:02 UTC daily                     | Retention purge job          | Move schedule off peak; throttle                     |
| All endpoints slow                           | DB connection pool exhausted | Bounce pods; confirm `DB_POOL_SIZE` matches replicas |

## 3. Mitigations (low-risk)

```bash
# Scale out immediately
kubectl scale deploy/dms-python -n nbe-dms --replicas=6

# Temporarily shed non-critical traffic via ingress rate limit (annotation already present)
kubectl annotate ingress dms-python -n nbe-dms \
  nginx.ingress.kubernetes.io/limit-rpm=300 --overwrite

# Roll back last deploy if correlated with incident
kubectl rollout undo deploy/dms-python -n nbe-dms
```

## 4. Mitigations (risky — get second pair of eyes)

- Failover DB to replica: [DR-RUNBOOK §3](../DR-RUNBOOK.md)
- Disable affected router via env `DMS_DISABLED_ROUTERS=integrations,ocr`
  (add this to your settings if not present yet).

## 5. Post-incident

- File a Jira blameless postmortem within 24 h
- Update this runbook with any new symptom / fix
- Verify error budget status in Grafana's SLO panel
