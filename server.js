const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const db = require('./db');
const ws = require('./services/ws');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: 'nbe-dms-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get('/login', (req, res) => res.render('login', { error: null, mfaRequired: false, username: '' }));

app.post('/login', (req, res) => {
  const bcrypt = require('bcryptjs');
  const { verifyToken } = require('./services/mfa');
  const { username, password, mfa_token } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid credentials' });
  }
  if (user.status === 'Locked') return res.render('login', { error: 'Account locked' });
  if (user.mfa_enabled && user.mfa_secret) {
    if (!mfa_token) return res.render('login', { error: 'MFA code required', mfaRequired: true, username });
    if (!verifyToken(user.mfa_secret, mfa_token)) {
      return res.render('login', { error: 'Invalid MFA code', mfaRequired: true, username });
    }
  }
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, branch: user.branch };
  db.prepare('INSERT INTO audit_log (user_id, action, entity) VALUES (?, ?, ?)').run(user.id, 'LOGIN', 'user');
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use('/api/v1', require('./routes/api'));
app.use('/py', require('./routes/py-proxy'));
app.use('/graphql', ...require('./routes/graphql'));
app.use('/webhooks', express.json(), require('./routes/webhooks'));
app.use('/portal', require('./routes/portal'));
app.use('/', requireAuth, require('./routes/dashboard'));
app.use('/documents', requireAuth, require('./routes/documents'));
app.use('/workflows', requireAuth, require('./routes/workflows'));
app.use('/alerts', requireAuth, require('./routes/alerts'));
app.use('/search', requireAuth, require('./routes/search'));
app.use('/admin', requireAuth, require('./routes/admin'));
app.use('/reports', requireAuth, require('./routes/reports'));
app.use('/mfa', requireAuth, require('./routes/mfa'));
app.use('/exports', requireAuth, require('./routes/exports'));
app.use('/versions', requireAuth, require('./routes/versions'));
app.use('/bulk', requireAuth, require('./routes/bulk'));
app.use('/workflow-templates', requireAuth, require('./routes/workflow-templates'));
app.use('/annotations', requireAuth, require('./routes/annotations'));
app.use('/import', requireAuth, require('./routes/import'));
app.use('/audit', requireAuth, require('./routes/audit'));
app.use('/bi', requireAuth, require('./routes/bi'));

require('./services/saml').configure(app);
require('./services/expiry-job').start();
require('./services/retention').start();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
ws.attach(server);
server.listen(PORT, () => console.log(`NBE DMS running on http://localhost:${PORT}`));
