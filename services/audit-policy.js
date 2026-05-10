'use strict';

/**
 * Build the policy_decision JSON blob persisted alongside every mutation row.
 * Reads from req.session.user (Node session) and the optional OPA decision.
 *
 * @param {import('express').Request|null} req
 * @param {object} [opts]
 * @param {boolean} [opts.opaAllow=true]
 * @param {string|null} [opts.opaReason=null]
 * @returns {{ role: string|null, tenant_id: string|null, branch: string|null, risk_band: string|null, opa_allow: boolean, opa_reason: string|null, captured_at: string }}
 */
function buildPolicyDecision(req, { opaAllow = true, opaReason = null } = {}) {
  const u = (req && req.session && req.session.user) || {};
  return {
    role:        u.role        || null,
    tenant_id:   u.tenant_id   || null,
    branch:      u.branch      || null,
    risk_band:   (req && req.body && req.body.risk_band) || null,
    opa_allow:   opaAllow,
    opa_reason:  opaReason,
    captured_at: new Date().toISOString(),
  };
}

module.exports = { buildPolicyDecision };
