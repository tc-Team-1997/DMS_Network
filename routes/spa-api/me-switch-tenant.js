'use strict';

/**
 * POST /spa/api/me/switch-tenant
 * body: { tenant_id: string }
 *
 * Checks whether the logged-in user has access to the target tenant.
 * For now the users table has a single tenant_id column (no many-to-many
 * join table), so cross-tenant switching is not supported in this build.
 * Returns 403 with a structured error so the SPA can surface a clear message.
 *
 * TODO Wave B Users-v2: add a user_tenants join table and implement real
 * multi-tenant user mapping here. The SPA chip dropdown already lists
 * available_tenants from GET /spa/api/me — once Users-v2 lands, this
 * endpoint should re-authenticate into the target tenant context.
 */

const express = require('express');

const router = express.Router();

router.post('/me/switch-tenant', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const { tenant_id } = req.body || {};
  if (!tenant_id || typeof tenant_id !== 'string') {
    return res.status(400).json({ error: 'tenant_id is required' });
  }

  const currentTenantId = req.session.user.tenant_id || 'nbe';

  // If the user is already on this tenant, it's a no-op success.
  if (tenant_id === currentTenantId) {
    return res.json({ ok: true, tenant_id });
  }

  // Multi-tenant user model not yet implemented — Wave B Users-v2 owed.
  return res.status(403).json({
    error: 'multi_tenant_not_supported',
    message:
      'Switching tenants within the same session is not yet supported. ' +
      'Sign out and sign in under the target tenant.',
    owed_by: 'Wave B Users-v2',
  });
});

module.exports = router;
