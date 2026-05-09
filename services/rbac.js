const PERMS = {
  'Doc Admin':  ['capture','index','approve','reject','admin','security','delete','upload','view','workflow',
                 'aml:read','aml:review','aml:admin',
                 'cbs:read','cbs:write','cbs:admin',
                 'worm:read','worm:admin',
                 'documents:redact','view_unredacted',
                 'kyc:write','kyc:read',
                 'translate:read','translate:delete',
                 'regulator_reports:read','regulator_reports:admin'],
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
  'auditor':    ['view','aml:read','cbs:read','worm:read','view_unredacted','kyc:read','translate:read',
                 'regulator_reports:read'],
  'compliance': ['view','aml:read','aml:review','cbs:read','worm:read','translate:read',
                 'regulator_reports:read'],
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
 * Default: only Doc Admin may read/write any namespace.
 *
 * NAMESPACE_READERS overrides the read check for specific namespaces so that
 * privileged-but-non-admin roles (auditor, compliance) can access their data.
 * Write access always requires Doc Admin regardless of this map.
 *
 * To add a new namespace override: add an entry to NAMESPACE_READERS below.
 * No handler-level changes are needed — audit endpoints call
 * requireNamespacePermJson('audit_log', 'read') or ('audit_log', 'write').
 */
const NAMESPACE_READERS = /** @type {Record<string, string[]>} */ ({
  audit_log: ['Doc Admin', 'auditor', 'compliance'],
  // future: reports: ['Doc Admin', 'auditor', 'compliance'],
});

/**
 * @param {object|null|undefined} user
 * @param {string} namespace
 * @param {'read'|'write'} [mode='write']
 * @returns {boolean}
 */
function hasNamespacePerm(user, namespace, mode = 'write') {
  if (!user) return false;
  if (mode === 'read' && NAMESPACE_READERS[namespace]) {
    return NAMESPACE_READERS[namespace].includes(user.role);
  }
  // Writes (and reads where no override exists) require Doc Admin.
  return user.role === 'Doc Admin';
}

/**
 * Express middleware factory — returns 403 JSON if the caller does not
 * satisfy hasNamespacePerm for the given namespace + mode.
 *
 * Pass a static string when the namespace is fixed (e.g. 'audit_log').
 * Pass null to read req.params.namespace at request time (for parameterised
 * routes like /admin/config/:namespace).
 *
 * @param {string|null} namespace
 * @param {'read'|'write'} [mode='write']
 */
function requireNamespacePermJson(namespace, mode = 'write') {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    const ns = namespace !== null ? namespace : (req.params.namespace || '');
    if (!hasNamespacePerm(user, ns, mode)) {
      return res.status(403).json({ error: 'forbidden', perm: `settings.${ns}` });
    }
    next();
  };
}

module.exports = { can, require, PERMS, hasNamespacePerm, requireNamespacePermJson };
