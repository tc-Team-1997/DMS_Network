const PERMS = {
  'Doc Admin': ['capture','index','approve','reject','admin','security','delete','upload','view','workflow'],
  'Maker':     ['capture','index','upload','view','workflow'],
  'Checker':   ['approve','reject','view','workflow'],
  'Viewer':    ['view']
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
