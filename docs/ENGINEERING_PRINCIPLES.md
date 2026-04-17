# DocManager — Engineering Principles

> **How we build, how we review, how we ship — so tenants 1 and 1,000 get the same quality.**
>
> Paired with [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) (the *what*) and [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md) (the *don't break this*).

---

## 1. The ten commandments

These are not aspirations. These are the rules. A PR that violates one of these gets rejected on sight.

1. **No raw `tenant_id`-less query.** Every SQL touches a tenant boundary — enforced by the ORM layer and by DB RLS.
2. **No unmapped value in logs.** Structured logs only. No `console.log(everything)`; no `print(user)`.
3. **No secret in code.** Vault / KMS / env vars (via Vault). Pre-commit hook catches violations.
4. **No bypass of the observability contract.** Every handler has a trace, a metric, and a structured log line.
5. **No sync LLM on the request path.** If it takes > 500ms, queue it.
6. **No cross-module import below `modules/`.** Shared concerns belong in `lib/`, `components/ui/`, `packages/shared`.
7. **No new dependency without a review.** Supply chain is a real risk — new deps need a second engineer's sign-off.
8. **No PR without a test.** New code path → new test. Bug fix → regression test.
9. **No merge without CI green.** Not "mostly green." Green.
10. **No "I'll document it later."** Docs in the same PR, or the PR doesn't land.

---

## 2. Module boundaries

### 2.1 The module = a deployable unit of thought

A module is a folder under `apps/web/src/modules/` (SPA) or `python-service/app/routers/` + `services/` (backend) that maps to **one domain concept** (capture, workflow, retention, fraud…).

A well-formed module:
- Owns its API types, its routes, its UI, its workers.
- Does not import from another module.
- Communicates with the rest of the system via **events** (for writes) or the **service registry** (for reads).
- Has its own tests, own README, own metrics dashboard.

### 2.2 The dependency rules

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│                       Application                             │
│                 (apps/web, apps/admin, mobile)                │
│                                                               │
│     ┌───────────────────────────────────────────────┐         │
│     │                  Modules                      │         │
│     │   capture  workflow  repository  alerts …     │         │
│     └─────────────┬─────────────┬─────────────┬─────┘         │
│                   │             │             │               │
│                   ▼             ▼             ▼               │
│           ┌───────────────────────────────────────┐           │
│           │              Shared libraries         │           │
│           │    (http · schemas · tokens · utils)  │           │
│           └───────────────────────────────────────┘           │
│                           │                                   │
│                           ▼                                   │
│              ┌──────────────────────────┐                     │
│              │      Platform primitives │                     │
│              │   tenant context · auth  │                     │
│              │   storage · queue        │                     │
│              └──────────────────────────┘                     │
└───────────────────────────────────────────────────────────────┘
```

Dependencies flow **downward only**. Platform does not know about modules. Modules do not know about each other.

### 2.3 Cross-module needs

When two modules need to interact:

- **Read:** publish via a service; the other module subscribes.
- **Write:** emit an event; the other module consumes.
- **Shared data shape:** extract to `packages/shared` (TypeScript) / `python-service/app/shared/` (Python).

Never import across modules directly. Ever.

---

## 3. Tenant safety

The single most important invariant. Full detail in [TARGET_ARCHITECTURE.md §4](./TARGET_ARCHITECTURE.md#4-tenancy-model--the-most-important-invariant).

Engineering rules:

- **Repositories take `TenantContext` explicitly.** No global / thread-local tenant state that could leak between requests.
- **All queries use the ORM.** Raw SQL requires CISO-level approval and a security review.
- **Every cache key is tenant-scoped.** `cache.get(f"{tenant_id}:documents:{id}")` — never `cache.get(f"documents:{id}")`.
- **Every S3 key is tenant-scoped.** `tenants/{tenant_id}/sha256/{hash}` — the tenant_id is in the path.
- **Every Kafka message has `tenant_id` in the header.** Consumers fail closed if the header is missing.
- **Every log / metric / trace carries `tenant_id` as an attribute.**
- **Pen test tenant isolation every release.** Automated test: spin up tenant A and B, perform every operation, assert zero cross-access at the DB, queue, cache, search, and storage layers.

---

## 4. Code style & structure

### 4.1 TypeScript

- Strict mode. Always. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- `any` is banned — `@typescript-eslint/no-explicit-any: error`.
- Runtime validation with Zod at every external boundary.
- React: hooks, function components, named exports. Never default exports (they cause silent import drift).
- Files ≤ 400 lines. Split when larger.
- No React class components.
- Formatting: Prettier, non-negotiable. Config checked in.

### 4.2 Python

- Type hints mandatory on all signatures; `mypy --strict` clean.
- Pydantic v2 at every external boundary.
- `ruff` for lint + format; no debates.
- No global state; DI via FastAPI's Depends.
- Prefer async where I/O-bound; `asyncio`-aware SQLAlchemy.
- No bare `except`; always specific.
- Logging: `structlog` with JSON output.

### 4.3 Style: readable > clever

- Naming: explicit, not short. `tenantId` > `t`. `documentExpiryDate` > `ded`.
- Comments explain **why**, not **what**. The code shows what.
- Functions do one thing. If the name has "and" in it, split it.
- Limit arguments: ≤ 4; past that, use a typed options object.

### 4.4 Comments

Default to none. Write one only when the *why* isn't obvious from the code:

- A workaround for a specific bug (link it).
- A non-obvious invariant (the ordering matters, the null value is significant).
- A hidden constraint (upstream API forbids this combination).

Never explain *what* the code does.
Never reference current PR context, ticket numbers, or "added because of X" — that lives in commit messages.

---

## 5. Testing

### 5.1 The testing pyramid

```
                    ┌──────────────────┐
                    │       E2E        │   (~20 critical user journeys)
                    │   Playwright     │
                    └──────────────────┘
                  ┌────────────────────────┐
                  │       Integration      │   (~200 service boundaries)
                  │   pytest + Testcontainers│
                  └────────────────────────┘
                ┌─────────────────────────────┐
                │            Unit             │   (~2000+)
                │    Jest / pytest · pure     │
                └─────────────────────────────┘
```

### 5.2 The "test must exist" rule

- New public function → unit test.
- New API endpoint → integration test.
- New page → Playwright test (at least one happy path).
- New workflow → workflow simulator test.
- Bug fix → regression test that fails before the fix, passes after.

### 5.3 Test quality bar

- Test names describe the behaviour, not the code. `test_expired_document_cannot_be_approved` > `test_approve_workflow_4`.
- No shared mutable state across tests. Each test sets up and tears down.
- Fixtures > helpers > magic constants.
- Fakes > mocks. Only mock what you don't own.
- Deterministic. No flaky tests. If a test is flaky, it's worse than no test.

### 5.4 E2E coverage target

20 user journeys kept always-green:
1. Sign in / sign out
2. Sign in with MFA
3. Upload a document
4. Auto-classification flow
5. Workflow approve (maker → checker)
6. Workflow reject
7. Search by customer CID
8. Search by OCR text
9. View document + metadata
10. Download document
11. Delete document (admin-only RBAC check)
12. Create workflow template
13. Publish workflow template change
14. Mark alert read
15. Bulk upload
16. Export audit log
17. DSAR request
18. Configure integration adapter
19. Tenant admin: provision user
20. Tenant admin: rotate encryption key

### 5.5 Load & resilience testing

- **k6** load tests per quarter, scripts versioned.
- **Chaos testing** on staging: random pod kills, network partitions, DB failover. LitmusChaos or Gremlin.
- **Fuzz testing** on inputs: document parsers, OCR pipeline, API request bodies. We have `python-service/app/services/failpoint.py` stub.

---

## 6. CI/CD

### 6.1 PR pipeline (must all pass)

```
On every push to a PR branch:
  ├─ lint (eslint + ruff)
  ├─ typecheck (tsc + mypy)
  ├─ unit tests (jest + pytest)
  ├─ integration tests (testcontainers-backed)
  ├─ build (vite + docker)
  ├─ container scan (trivy)
  ├─ dependency scan (snyk/dependabot)
  ├─ secret scan (trufflehog)
  ├─ SAST (semgrep + codeql)
  ├─ IaC scan (checkov on terraform, kube-bench on helm)
  ├─ license check (fossa or scancode)
  └─ SBOM generation
```

Merge blocked until all green. No exceptions.

### 6.2 Main branch pipeline

On merge to `main`:
- Full test suite (including E2E on ephemeral env).
- Build signed artifacts (cosign + SLSA provenance).
- Publish to internal container registry.
- Deploy to staging automatically.

### 6.3 Release

- Tag triggers release pipeline.
- Staging soak: 24 hours min, no P1/P2 issues.
- Canary deploy to 1 tenant (internal test tenant).
- Phased rollout: 5% → 25% → 100% production, auto-rollback on SLO breach.
- Release notes published with every tag.

### 6.4 Hotfix

- Hotfix branch from last release tag.
- Same gates, no shortcuts.
- If a gate is what's broken, fix the gate first.

---

## 7. Observability contract

Every service must emit:

### 7.1 Traces

- OpenTelemetry, context-propagated across services.
- Span per request, child spans per downstream call.
- Attributes always include: `tenant_id`, `user_id`, `request_id`, `service_version`.

### 7.2 Metrics

- `req_total{tenant, endpoint, status}` counter
- `req_duration_seconds{tenant, endpoint}` histogram
- `errors_total{tenant, endpoint, error_type}` counter
- Custom business metrics per service (documents_processed, workflow_transitions, ai_calls…)

### 7.3 Logs

- Structured JSON.
- Standard fields: `time`, `level`, `tenant_id`, `user_id`, `request_id`, `trace_id`, `service`, `msg`.
- No PII in messages (enforced at logger layer).
- Log levels:
  - `debug` — dev only, never in prod.
  - `info` — user-meaningful events (upload, login).
  - `warn` — degraded but recovered (retry, fallback).
  - `error` — operator action needed.
  - `critical` — paging.

### 7.4 Health checks

- `/health/live` — process is alive.
- `/health/ready` — ready to serve traffic (DB reachable, dependencies up).
- `/health/startup` — used by K8s startup probe.

---

## 8. Feature flags

- Every new feature lands behind a flag.
- Flags have an owner and a retirement date.
- **Stale flags are code smell.** Quarterly flag cleanup sprint.
- Flag evaluation is centralised (OpenFeature + flagd for on-prem, LaunchDarkly for SaaS).
- Flag state is auditable and tenant-scoped.

---

## 9. Documentation

### 9.1 The four layers

1. **In-code docstrings.** Function signatures + invariants. No prose.
2. **Module README.** Each module directory has a README explaining ownership, responsibilities, how to run its tests.
3. **Runbooks.** `docs/runbooks/*.md` — operator playbooks for common incidents ("Postgres disk full," "Qdrant OOM," "AI queue backlog").
4. **Architecture / product docs.** The set you're reading now.

### 9.2 ADRs (Architecture Decision Records)

Every non-trivial decision captured in `docs/adr/NNN-title.md`:
- Context
- Options considered
- Decision
- Consequences (pro/con/risks)

When we revisit the decision, we append — not rewrite.

### 9.3 Runbooks

Every service has a runbook. At minimum:
- What this service does (1 paragraph).
- Key dependencies.
- SLIs and SLOs.
- Common alerts and their responses.
- "Break glass" procedures.
- Who to escalate to.

---

## 10. On-call & ops

### 10.1 Primary on-call

- 1 week rotation.
- SRE pod provides primary.
- Secondary rotates across product pods.

### 10.2 On-call sanity rules

- No pages below SEV3 outside business hours.
- Silencing an alert requires a matching ticket.
- Every page generates a postmortem if MTTR > 30 minutes.

### 10.3 Runbook quality

- Every alert links to its runbook.
- Runbooks updated within 2 business days of any SEV1/SEV2.
- Quarterly runbook drill per service.

---

## 11. Dependency hygiene

### 11.1 Policy

- New dep requires a second engineer approval in PR.
- Preference: stdlib / existing deps > new deps.
- Preference: mature + maintained > "new and shiny."
- Transitive deps audited as part of supply chain scan.

### 11.2 Upgrade cadence

- Security patches: immediate.
- Minor versions: monthly review, Dependabot PRs.
- Major versions: quarterly review, planned work.

### 11.3 Deprecation

- We remove code when deprecated — no "maybe someone still uses it" rot.
- Deprecation window: 2 releases (6 months).
- Public API breaks require 12-month notice.

---

## 12. Performance culture

- Every feature carries a performance budget agreed in design.
- Regression gate on CI: p95 latency on critical paths must not degrade > 10% between releases.
- Bundle budget: SPA < 300 KB gzipped (current: 224 KB).
- Time-to-interactive < 2s on staging-grade connections.
- AI latency budget: classification < 3s, RAG chat < 6s end-to-end.

---

## 13. The "no surprises" principle

We don't surprise our teammates. Concretely:

- Large refactors broken into reviewable PRs, each individually green.
- Big architectural shifts via ADR + team review **before** code.
- Breaking changes announced in the team Slack channel + ADR + release notes.
- Deployments visible in the team feed; surprise deploys are a bug.

---

## 14. The "no surprises" principle — for customers

- Breaking API changes: 12-month notice + migration guide.
- Deprecated features: 2-release runway.
- Pricing changes: 90-day notice, grandfathered where contractually required.
- Major security advisories: public disclosure within 72 hours of patch GA.

---

## 15. Hiring signals (who we want on the team)

These principles imply the kind of people we hire:

- **Taste:** can smell overengineering a mile away.
- **Discipline:** ships small, green, well-tested slices.
- **Communication:** writes as well as they code; an engineer who can't write a README will not scale the org.
- **Skepticism:** questions premises; challenges product scope when warranted; pushes back on "just ship it."
- **Ownership:** if they break it, they fix it; if they built it, they maintain it.

The anti-profile:
- Adds abstraction before proving it's needed.
- Cites design patterns from textbooks instead of the domain.
- Never writes tests until forced.
- Engages only in Slack threads, never in code review.
- "Not my module."

---

## 16. Daily / weekly / quarterly rituals

### Daily

- Stand-up (15 min, async-preferred).
- On-call handoff (3 min, end of shift).

### Weekly

- Pod retro (45 min): what shipped, what blocked, what to fix.
- Platform review (45 min): cross-pod, incidents, SLO trends.
- Deploy review (30 min): what's going to prod next week.

### Bi-weekly

- Architecture review (60 min): open ADRs, design decisions.
- Customer feedback review (60 min): product + pod leads read recent customer calls/tickets.

### Quarterly

- Roadmap review (half-day): exec + pod leads against [ROADMAP.md](./ROADMAP.md).
- Threat model refresh (half-day): security champions.
- Flag cleanup sprint (1 day).
- Postmortem meta-review (1 day): patterns across incidents.

### Semi-annual

- External pen test.
- DR drill (full-stack regional failover).
- Compensation calibration.

### Annual

- Strategy offsite (3 days).
- Cert renewals (SOC 2, ISO 27001).
- Compensation review.

---

## 17. The anti-list

- **No heroes.** If someone is indispensable, we've failed the system.
- **No "move fast and break things."** We move fast and don't break things, because the cost of breaking a bank's documents is our business.
- **No "technical debt" as excuse.** Debt is addressed, not complained about.
- **No premature optimisation.** Profile first.
- **No "not invented here."** Use the best tool; build only when nothing fits.
- **No "it works on my machine."** The env is containerised and reproducible.
- **No private critical knowledge.** If only one person knows something, it's a bug.

---

## 18. The one-sentence version

> **Ship small, green, observable, tenant-safe slices — with docs and tests — or don't ship.**
