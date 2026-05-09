# ADR-0013: Step-Up Enforcement Server-Side REJECTION Contract

**Date**: 2026-05-10  
**Status**: Accepted (Wave A, commit 06d3967; Wave B extends)  
**Deciders**: Security, Architecture  
**Affects**: Workflow v2 (Wave A) and AML v2 (Wave B)

---

## Context

"Step-up" is a security control: high-risk actions (approving high-amount workflows, deciding high-risk AML hits) require additional authentication (WebAuthn, SMS code, etc.) before proceeding.

Options:
1. **Client-side gate** — SPA checks if assertion is present, client doesn't call server if missing (too weak; client can be bypassed)
2. **Server silent skip** — server allows action without assertion if threshold not met (confusion, inconsistent security)
3. **Server REJECTS** — server returns 403 step_up_required if threshold met but assertion missing (strong signal, client knows to retry with assertion)

---

## Decision

Implement **server-side REJECTION contract**:

- **Workflows v2 (Wave A)**:
  - Thresholds read from `tenant_config.workflows.{step_up_risk_band, step_up_amount_threshold}`
  - Example: step_up_risk_band="High", step_up_amount_threshold=500,000
  - When user submits workflow approval:
    - Server checks: `workflow.risk_band >= config.step_up_risk_band` OR `workflow.amount >= config.step_up_amount_threshold`
    - If threshold met AND `wf_actions.webauthn_assertion_id` is NULL/empty:
      - **REJECT** with `403 step_up_required` + response body: `{ error: "step_up_required", ... }`
    - If threshold met AND assertion present:
      - **Proceed** (assertion is stored but not yet cryptographically validated — SOX debt Wave C)
  - Two TODO(SOX) markers in routes/spa-api/workflows.js document this gap

- **AML v2 (Wave B)**:
  - Same pattern: `step_up_risk_band >= config.aml.step_up_risk_band` triggers step-up
  - Shared lib/step-up.ts with Workflows v2 (reusable component)
  - Same 403 rejection if assertion missing

- **Client behavior**:
  - Catch 403 step_up_required response
  - Route to `/spa/api/stepup/authenticate` (call py-proxy to `POST /py/api/v1/stepup/authenticate`)
  - Collect WebAuthn credential (library: SimpleWebAuthn)
  - Retry original request with assertion header

---

## Consequences

### Positive

- **Strong security signal** — 403 is unmistakable; client knows what to do
- **Separation of concerns** — server enforces policy, client implements UX
- **Audit trail** — every rejection logged; attempted high-risk actions without step-up are visible
- **Works offline (partial)** — client can at least detect threshold and prompt for step-up before network

### Negative

- **User friction** — step-up adds 10–30 seconds per action; must be rare enough to not annoy
- **WebAuthn complexity** — credentials can fail, be lost, etc.; requires fallback auth paths (SMS TBD Wave C)
- **Assertion storage without validation is a SOX gap** — webauthn_assertion_id is stored in wf_actions/aml_hit_suppressions but not cryptographically verified server-side (Wave C must proxy to POST /py/api/v1/stepup/verify)

### Risk

- **Assertion spoofing** — if assertion is not validated, attacker could forge the id field
  - **Mitigated by SOX debt**: Wave C must add cryptographic verification before go-live

---

## Alternatives Considered

1. **Client-side gate only** — rejected (can be bypassed)
2. **Server silent skip** — rejected (inconsistent, loses audit signal)
3. **Timeout-based step-up** (require auth if last login > 15 minutes) — rejected (not risk-based, too coarse)

---

## Known Issues

**SOX-1 Debt**: webauthn_assertion_id is stored in `wf_actions` (Wave A) and `aml_hit_suppressions` (Wave B) but not cryptographically validated server-side. The threshold check IS enforced — server returns 403 step_up_required when missing — but a determined attacker could forge the id field.

**Wave C must close this by**: proxying to POST `/py/api/v1/stepup/verify` before storing the assertion. Assertion must match registered credential for the user.

---

## Related

- [Commit 06d3967 (Wave A Workflows v2)](../../CHANGELOG.md#unreleased--commit-06d3967--2026-05-10)
- [Commit 9bbae4a (Wave B AML v2)](../../CHANGELOG.md#unreleased--commit-9bbae4a--2026-05-10)
- [PLATFORM_CONFIG.md § workflows](../PLATFORM_CONFIG.md#6-workflows)
- [PLATFORM_CONFIG.md § aml](../PLATFORM_CONFIG.md#14-aml)
- [CHANGELOG.md § SOX-1 debt](../../CHANGELOG.md#sox-1-webauthn-assertion-cryptographic-validation-wave-c)
- Shared step-up lib: `apps/web/src/lib/step-up.ts`
- Workflows router: `routes/spa-api/workflows.js`
- AML router: `routes/spa-api/aml.js`
- Python step-up: `python-service/app/routers/stepup.py`
