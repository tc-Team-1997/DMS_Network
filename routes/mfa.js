const router = require('express').Router();
const db = require('../db');
const { generateSecret, makeQrDataUrl, verifyToken } = require('../services/mfa');
const crypto = require('crypto');

router.get('/setup', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const secret = generateSecret(u.username);
  req.session.pendingMfaSecret = secret.base32;
  const qr = await makeQrDataUrl(secret.otpauth_url);
  res.render('mfa-setup', { active: 'admin', qr, secret: secret.base32 });
});

router.post('/verify', (req, res) => {
  const { token } = req.body;
  const secret = req.session.pendingMfaSecret;
  if (!secret) return res.redirect('/mfa/setup');
  if (!verifyToken(secret, token)) {
    return res.render('mfa-setup', { active: 'admin', qr: null, secret, error: 'Invalid code' });
  }
  db.prepare('UPDATE users SET mfa_enabled=1, mfa_secret=? WHERE id=?').run(secret, req.session.user.id);
  delete req.session.pendingMfaSecret;
  res.redirect('/admin/security');
});

router.post('/api-key', (req, res) => {
  const key = 'nbe_' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET api_key=? WHERE id=?').run(key, req.session.user.id);
  res.render('api-key', { active: 'admin', key });
});

module.exports = router;
