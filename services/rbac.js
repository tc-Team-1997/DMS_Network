const PERMS = {
  'Doc Admin':  ['capture','index','approve','reject','admin','security','delete','upload','view','workflow',
                 'aml:read','aml:review','aml:admin',
                 'cbs:read','cbs:write','cbs:admin',
                 'worm:read','worm:admin',
                 'documents:redact','view_unredacted',
                 'kyc:write','kyc:read',
                 'translate:read','translate:delete'],
  'Maker':      ['capture','index','upload','view','workflow',
                 'aml:read',
                 'cbs:read','cbs:write',
                 'worm:read',
                 'documents:redact',
                 'kyc:write',
                 'translate:read'],
  'Checker':    ['approve','reject','view','workflow',
                 'aml:read',
                 'cbs:read','cbs:write',
                 'worm:read',
                 'documents:redact',
                 'translate:read'],
  'Viewer':     ['view',
                 'aml:read',
                 'cbs:read',
                 'worm:read',
                 'translate:read'],
  // Extended roles added for AML + CBS compliance surfaces.
  // These roles are set on users whose `role` column carries the value below.
  'auditor':    ['view','aml:read','cbs:read','worm:read','view_unredacted','kyc:read','translate:read'],
  'compliance': ['view','aml:read','aml:review','cbs:read','worm:read','translate:read'],
};

function can(role, perm) {
  const allowed = PERMS[role] || [];
  return allowed.includes(perm);
}

function require(perm) {
  return (req, res, next) => {
    const role = req.session && req.session.user && req.session.user.role;
    if (!role || !can(role, perm)) {
      return res.status(403).render('forbidden', { active: '', perm });
    }
    next();
  };
}

/**
 * Per-namespace settings permission check.
 *
 * Today this is a thin wrapper: only Doc Admin may read/write any namespace.
 * Future per-namespace RBAC (e.g. perm:'settings.branding') becomes a
 * one-function change here — all six admin-config + admin-tenants endpoints
 * call this, so no handler-level edits are needed for that migration.
 *
 * @param {object|null|undefined} user      - req.session.user
 * @param {string}                _namespace - reserved for future per-ns logic
 * @returns {boolean}
 */
function hasNamespacePerm(user, _namespace) {
  return user != null && user.role === 'Doc Admin';
}

/**
 * Express middleware factory — returns 403 JSON if the caller does not
 * satisfy hasNamespacePerm for the given namespace.
 *
 * Pass a static string when the namespace is fixed (e.g. 'tenants').
 * Pass null to read req.params.namespace at request time (for parameterised
 * routes like /admin/config/:namespace).
 *
 * @param {string|null} namespace
 */
function requireNamespacePermJson(namespace) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    const ns = namespace !== null ? namespace : (req.params.namespace || '');
    if (!hasNamespacePerm(user, ns)) {
      return res.status(403).json({ error: 'forbidden', perm: `settings.${ns}` });
    }
    next();
  };
}

module.exports = { can, require, PERMS, hasNamespacePerm, requireNamespacePermJson };
