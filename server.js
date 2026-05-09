const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const db = require('./db');
const ws = require('./services/ws');
const { createSessionStore, redis: sessionRedis } = require('./services/session-store');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Baseline security headers. The EJS app loads Chart.js + Google Fonts from
// CDNs so we keep script-src permissive for those origins; tighten further
// once the EJS surface is retired in favor of apps/web.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SAMEORIGIN (not DENY) so the SPA iframe can preview /uploads/* PDFs.
  // Same-origin is enforced — cross-origin embeds still blocked.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const SESSION_TTL_SECONDS     = parseInt(process.env.SESSION_TTL_SECONDS     || '7200', 10);  // 2h
const SESSION_EXTEND_SECONDS  = parseInt(process.env.SESSION_EXTEND_SECONDS  || '3600', 10);  // +1h
const SESSION_WARNING_SECONDS = parseInt(process.env.SESSION_WARNING_SECONDS || '1800', 10);  // 30m banner

app.locals.sessionConfig = {
  ttl:     SESSION_TTL_SECONDS,
  extend:  SESSION_EXTEND_SECONDS,
  warning: SESSION_WARNING_SECONDS,
};

const _sessionStore = createSessionStore();

app.use(session({
  store: _sessionStore,
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  name: 'dms.sid',
  resave: false,
  rolling: true,           // sliding expiration on every request
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS * 1000,
  },
}));

// Activity refresh middleware: update last_active_at in Redis on every
// non-polling request, fire-and-forget so latency is unaffected.
app.use((req, _res, next) => {
  // Skip the session-status polling endpoint so it doesn't act as activity.
  if (req.path === '/spa/api/auth/session-status') return next();
  if (req.session && req.session.user) {
    const sid = req.sessionID;
    if (sid) {
      setImmediate(() => {
        sessionRedis.hset(`dms:session-meta:${sid}`, 'last_active_at', new Date().toISOString())
          .catch(() => {});
      });
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Tenant branding middleware — populates res.locals.tenant for all EJS
// templates (login, portal-login, authenticated views).
// Rules (per CC2 plan):
//   • If the session has a tenant_id → load that specific tenant.
//   • Otherwise → load the first active tenant (same deterministic query
//     used by GET /spa/api/tenant-public).
// The loaders cache their results in module scope so unauthenticated requests
// (e.g. login page paints) don't hit SQLite on every render.
{
  // loadTenant and loadDefaultTenant are named properties on the router export.
  const tenantPublic = require('./routes/spa-api/tenant-public');
  const loadTenant = tenantPublic.loadTenant;
  const loadDefaultTenant = tenantPublic.loadDefaultTenant;
  app.use((req, res, next) => {
    const tenantId = req.session?.user?.tenant_id;
    res.locals.tenant = tenantId ? loadTenant(tenantId) : loadDefaultTenant();
    next();
  });
}

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

  // Per-user session tracking in Redis (no-op when Redis is not configured).
  req.session.save(() => {
    const sid = req.sessionID;
    const ttlSeconds = SESSION_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const now = new Date().toISOString();
    const meta = JSON.stringify({
      userId: user.id,
      createdAt: now,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
      last_active_at: now,
    });
    sessionRedis.hset(`dms:user-sessions:${user.id}`, sid, expiresAt).catch(() => {});
    sessionRedis.expire(`dms:user-sessions:${user.id}`, ttlSeconds + 300).catch(() => {});
    sessionRedis.set(`dms:session-meta:${sid}`, meta, 'EX', ttlSeconds + 300).catch(() => {});
  });

  res.redirect('/');
});

app.get('/logout', (req, res) => {
  const sid = req.sessionID;
  const userId = req.session?.user?.id;
  if (sid && userId) {
    sessionRedis.hdel(`dms:user-sessions:${userId}`, sid).catch(() => {});
    sessionRedis.del(`dms:session-meta:${sid}`).catch(() => {});
  }
  req.session.destroy(() => res.redirect('/login'));
});

app.use('/api/v1', require('./routes/api'));
app.use('/spa/api', require('./routes/spa-api'));
// /py forwards to the Python FastAPI service. Require a valid session so an
// unauthenticated browser can't reach the Python API surface via the proxy.
app.use('/py', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}, require('./routes/py-proxy'));
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
require('./services/offline-sync').start(parseInt(process.env.OFFLINE_SYNC_INTERVAL_SEC || '15', 10));
require('./services/indexing-sweeper').start();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Node 18+ defaults headersTimeout=60s and requestTimeout=300s, which is
// too tight for our long-running proxy routes (LLM analyze, glossary
// regenerate, multi-page OCR). Bump both to 10 minutes so the HTTP layer
// stops enforcing a shorter ceiling than our pyCall / axios defaults.
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 65_000;

ws.attach(server);
server.listen(PORT, () => console.log(`NBE DMS running on http://localhost:${PORT}`));
