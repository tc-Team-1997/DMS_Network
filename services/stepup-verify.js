'use strict';
/**
 * Node-side helper: call Python POST /api/v1/stepup/verify via the py-proxy
 * before any handler stores a webauthn_assertion_id.
 *
 * Returns { verified: true, factor, verified_at, expires_at } on success.
 * Throws an Error with .status=401 and .detail={verified:false,reason} on failure.
 *
 * Usage in route handlers:
 *   const { verifyStepUpAssertion } = require('../../services/stepup-verify');
 *   await verifyStepUpAssertion(assertionId, userSub, tenantId, actionContext);
 *   // throws if invalid; continue on success
 */

const { pyCall } = require('../routes/spa-api/_shared');

/**
 * Verify a WebAuthn assertion_id against the Python step-up verify endpoint.
 *
 * @param {string}      assertionId   - opaque string from request body
 * @param {string}      userSub       - username / user sub from session
 * @param {string}      tenantId      - from tenantScope(req)
 * @param {string|null} actionContext - optional label for logging
 * @returns {Promise<{verified:true, factor:string, verified_at:string, expires_at:string}>}
 * @throws  Error with .status=401 when verification fails
 */
async function verifyStepUpAssertion(assertionId, userSub, tenantId, actionContext) {
  let result;
  try {
    result = await pyCall('/api/v1/stepup/verify', {
      method:  'POST',
      body: {
        assertion_id:   assertionId,
        user_id:        userSub,
        action_context: actionContext || null,
        tenant_id:      tenantId || 'nbe',
      },
      timeout: 8_000,
    });
  } catch (err) {
    // pyCall rejects for non-2xx; extract detail from Python's 401 response.
    const detail = err.data || { verified: false, reason: 'proxy_error' };
    const error = new Error('step_up_invalid');
    error.status = 401;
    error.detail = detail;
    throw error;
  }

  if (!result || !result.verified) {
    const error = new Error('step_up_invalid');
    error.status = 401;
    error.detail = result || { verified: false, reason: 'unknown' };
    throw error;
  }

  return result;
}

module.exports = { verifyStepUpAssertion };
