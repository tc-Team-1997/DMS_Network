const PERMS = {
  'Doc Admin':  ['capture','index','approve','reject','admin','security','delete','upload','view','workflow',
                 'aml:read','aml:review','aml:admin',
                 'cbs:read','cbs:write','cbs:admin'],
  'Maker':      ['capture','index','upload','view','workflow',
                 'aml:read',
                 'cbs:read','cbs:write'],
  'Checker':    ['approve','reject','view','workflow',
                 'aml:read',
                 'cbs:read','cbs:write'],
  'Viewer':     ['view',
                 'aml:read',
                 'cbs:read'],
  // Extended roles added for AML + CBS compliance surfaces.
  // These roles are set on users whose `role` column carries the value below.
  'auditor':    ['view','aml:read','cbs:read'],
  'compliance': ['view','aml:read','aml:review','cbs:read'],
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

module.exports = { can, require, PERMS };
