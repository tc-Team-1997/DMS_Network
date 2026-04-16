const passport = require('passport');
const db = require('../db');

function configure(app) {
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer = process.env.SAML_ISSUER || 'nbe-dms';
  const cert = process.env.SAML_IDP_CERT;

  if (!entryPoint || !cert) {
    console.log('[saml] not configured (set SAML_ENTRY_POINT and SAML_IDP_CERT to enable)');
    return false;
  }

  const { Strategy: SamlStrategy } = require('passport-saml');
  passport.use(new SamlStrategy({
    path: '/sso/saml/callback',
    entryPoint,
    issuer,
    cert
  }, (profile, done) => {
    const email = profile.email || profile.nameID;
    let user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(email, email);
    if (!user) {
      db.prepare('INSERT INTO users (username, password, full_name, email, role, branch) VALUES (?,?,?,?,?,?)')
        .run(email, 'SSO-NOLOGIN', profile.displayName || email, email, 'Viewer', profile.branch || null);
      user = db.prepare('SELECT * FROM users WHERE username=?').get(email);
    }
    done(null, user);
  }));

  passport.serializeUser((u, d) => d(null, u.id));
  passport.deserializeUser((id, d) => d(null, db.prepare('SELECT * FROM users WHERE id=?').get(id)));

  app.use(passport.initialize());
  app.get('/sso/saml', passport.authenticate('saml', { session: false }));
  app.post('/sso/saml/callback', passport.authenticate('saml', { session: false, failureRedirect: '/login' }), (req, res) => {
    req.session.user = { id: req.user.id, username: req.user.username, full_name: req.user.full_name, role: req.user.role, branch: req.user.branch };
    res.redirect('/');
  });
  console.log('[saml] SSO enabled at /sso/saml');
  return true;
}

module.exports = { configure };
