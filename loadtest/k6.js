// Load test for NBE DMS Python service.
// Run:  k6 run --vus 50 --duration 2m loadtest/k6.js
// Env:  BASE_URL, API_KEY

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const KEY = __ENV.API_KEY || "dev-key-change-me";
const H = { "X-API-Key": KEY, "Content-Type": "application/json" };

const kpiLatency = new Trend("kpi_latency", true);
const searchLatency = new Trend("search_latency", true);
const uploadErrors = new Counter("upload_errors");

export const options = {
  thresholds: {
    http_req_failed:    ["rate<0.01"],
    "http_req_duration{name:kpis}":     ["p(95)<300"],
    "http_req_duration{name:search}":   ["p(95)<500"],
    "http_req_duration{name:upload}":   ["p(95)<800"],
  },
  scenarios: {
    reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "1m",  target: 50 },
        { duration: "30s", target: 0  },
      ],
      exec: "readPath",
    },
    writes: {
      executor: "constant-arrival-rate",
      rate: 5, timeUnit: "1s", duration: "2m",
      preAllocatedVUs: 10, maxVUs: 30,
      exec: "writePath",
    },
  },
};

export function readPath() {
  const k = http.get(`${BASE}/api/v1/dashboard/kpis`, { headers: H, tags: { name: "kpis" } });
  kpiLatency.add(k.timings.duration);
  check(k, { "kpis 200": (r) => r.status === 200 });

  const s = http.get(`${BASE}/api/v1/search?q=passport&limit=20`, { headers: H, tags: { name: "search" } });
  searchLatency.add(s.timings.duration);
  check(s, { "search 200": (r) => r.status === 200 });

  sleep(Math.random() * 1.5);
}

export function writePath() {
  const body = `passport demo ${__VU}-${__ITER}-${Date.now()}`;
  const form = {
    file: http.file(body, `load-${__VU}-${__ITER}.txt`, "text/plain"),
    doc_type: "passport",
    customer_cid: `EGY-LOAD-${String(__VU).padStart(4, "0")}`,
    uploaded_by: "k6",
  };
  const r = http.post(`${BASE}/api/v1/documents`, form, {
    headers: { "X-API-Key": KEY },
    tags: { name: "upload" },
  });
  if (r.status !== 200) uploadErrors.add(1);
  check(r, { "upload 200": (x) => x.status === 200 });
}
