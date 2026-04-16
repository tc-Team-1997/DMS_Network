# NBE DMS — Service Level Objectives

All targets measured over a **rolling 28-day window**. SLIs come from Prometheus
`dms_*` metrics. Each SLO has an associated error budget and a burn-rate alert.

| # | SLI                                    | SLO (target) | Error budget / 28d | Alert window / threshold              |
|---|----------------------------------------|--------------|---------------------|----------------------------------------|
| 1 | Availability — API 2xx/3xx             | 99.9%        | 40.3 min            | 1h @ 14.4× burn, 6h @ 6× burn          |
| 2 | Latency — p95 of `dms_http_request_seconds` under 500 ms on non-OCR endpoints | 99.0% of minutes | 6.72 h | 1h @ 14.4× |
| 3 | Ingestion success — `document.uploaded` / (`document.uploaded` + upload 5xx) | 99.5% | 3.36 h | 1h @ 14.4× |
| 4 | OCR completion — task `ocr.process` success rate | 99.0% | 6.72 h | 6h @ 6× |
| 5 | Workflow latency — median time capture → indexed | ≤ 30 s   | n/a (latency SLO) | 1h rolling p50 > 60 s → page |
| 6 | Webhook / replication delivery — 2xx rate | 99.5%     | 3.36 h              | 1h @ 14.4×                             |

## Ownership

| Domain            | Owner          | Escalation     |
|-------------------|----------------|----------------|
| API availability  | Platform team  | Head of SRE    |
| OCR pipeline      | AI/ML team     | Head of Data   |
| Integrations      | Integration    | Head of Eng    |
| Mobile offline    | Mobile team    | Head of Eng    |
| Security / WAF    | SecOps         | CISO           |

## Burn-rate policy (multi-window, multi-burn)

Page at **two independent** burn rates per SLO (Google SRE workbook §5):

- Fast burn: 2% of 28d budget in 1 hour → 14.4× burn
- Slow burn: 5% of 28d budget in 6 hours → 6× burn

Paging paths:
- **page** = PagerDuty on-call (2-minute ack)
- **ticket** = Jira INC board, `Blocker` priority
- Below slow-burn threshold → graph-only in Grafana, no page

## Monthly review

First Tuesday of each month: Head of SRE walks the SLO board with the owners.
Any SLO below 99% of target for two consecutive months triggers a dedicated
reliability sprint.
