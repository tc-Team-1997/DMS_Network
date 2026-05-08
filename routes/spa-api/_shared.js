/**
 * Shared helpers for the per-feature routers under routes/spa-api/.
 * These are the only cross-cutting concerns — auth gating, RBAC gating,
 * branch scoping, and the DocBrain (Python) proxy call.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const rbac = require('../../services/rbac');

const PY_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY  = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';

// Default to 10 minutes — Python endpoints that drive Ollama (docbrain
// analyze, classification, chat) frequently run past the old 2-minute
// ceiling on a cold model. Callers who need a shorter ceiling (e.g. auth
// checks) pass a smaller `timeout` explicitly.
function pyCall(subpath, { method = 'GET', body = null, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(subpath, PY_BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      method,
      headers: {
        'X-API-Key': PY_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    const req = lib.request(url, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error(`python ${res.statusCode}`);
        err.status = res.statusCode;
        err.data = parsed;
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('python timeout')); });
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    branch: u.branch,
    tenant_id: u.tenant_id || 'nbe',
  };
}

function requireAuthJson(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requirePermJson(perm) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    if (!role || !rbac.can(role, perm)) {
      return res.status(403).json({ error: 'forbidden', perm });
    }
    next();
  };
}

function branchScope(user) {
  return (user.role === 'Viewer' || user.role === 'Maker') && user.branch
    ? user.branch
    : null;
}

/**
 * Tenant resolution. For MVP every user belongs to the default tenant 'nbe'.
 * An optional `X-Tenant-ID` header from a trusted gateway can override it.
 * Feature flag for hardening: TENANT_TRUST_HEADER=1 accepts the header, else
 * derive from the logged-in user record.
 */
function tenantScope(req) {
  const trusted = process.env.TENANT_TRUST_HEADER === '1';
  if (trusted) {
    const hdr = req.headers['x-tenant-id'];
    if (typeof hdr === 'string' && hdr.trim()) return hdr.trim();
  }
  return req.session?.user?.tenant_id || 'nbe';
}

module.exports = {
  pyCall,
  publicUser,
  requireAuthJson,
  requirePermJson,
  branchScope,
  tenantScope,
};
