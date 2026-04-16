# Runbook — DMS p95 Latency Breach

**Paged via**: `DmsLatencyP95Breach` (p95 > 500 ms for 10 min)

## 1. Check which endpoint is slow

Grafana → `histogram_quantile(0.95, sum by (path, le) (rate(dms_http_request_seconds_bucket[5m])))`.

## 2. By endpoint

- `/api/v1/search` — Elasticsearch slow. Check `_cluster/health`, node heap, query logs.
  Fallback: unset `ELASTICSEARCH_URL` to force SQL-LIKE backend.
- `/api/v1/documents` — S3/disk IO. Confirm PVC throughput; for AWS increase IOPS.
- `/api/v1/ocr/*` — expected to be slow; only alert above 10 s p95.
- `/api/v1/vector/search` — sentence-transformers model first-call is cold; bump warmup.
- `/api/v1/copilot/ask` — LLM upstream slow. Toggle `OPENAI_API_KEY` off to use extractive.

## 3. Generic mitigations

- Scale pods: `kubectl scale deploy/dms-python --replicas=+2 -n nbe-dms`
- Bounce pods to shake loose bad connections: `kubectl rollout restart deploy/dms-python`
- If a single noisy tenant: apply per-tenant rate limit (WAF has per-IP, extend to `X-Tenant`)

## 4. Post-event

Open a perf ticket if it recurs more than twice in a week. Re-run k6:
`k6 run -e BASE_URL=https://dms.nbe.local -e API_KEY=$KEY loadtest/k6.js`
