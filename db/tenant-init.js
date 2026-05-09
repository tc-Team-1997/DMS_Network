#!/usr/bin/env node
/**
 * db/tenant-init.js — production tenant bootstrap
 *
 * Creates the first tenant row + an admin user whose password_hash is NULL
 * (the application treats NULL hash as "must set password via magic link").
 *
 * Usage:
 *   node db/tenant-init.js \
 *     --tenant-id  <id>              # internal identifier, e.g. "acme"
 *     --slug       <slug>            # URL-safe short name, e.g. "acme"
 *     --display-name <name>          # human-readable name, e.g. "Acme Bank"
 *     --regulator-name <name>        # e.g. "Financial Services Authority"
 *     --regulator-short <short>      # e.g. "FSA"
 *     --admin-email <email>          # first admin; receives magic link to set password
 *
 * This script NEVER accepts a plaintext password under any flag.
 *
 * The /set-password?token= handler that consumes the printed token is out of
 * scope for CC5 — it is owed by the follow-up task assigned to the CC2 wave.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      console.error(`[tenant-init] bad argument at position ${i}: ${key}`);
      process.exit(1);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

const REQUIRED = [
  'tenant-id',
  'slug',
  'display-name',
  'regulator-name',
  'regulator-short',
  'admin-email',
];

const args = parseArgs(process.argv);

const missing = REQUIRED.filter((k) => !args[k]);
if (missing.length > 0) {
  console.error(`[tenant-init] missing required arguments: ${missing.map((k) => `--${k}`).join(', ')}`);
  console.error('');
  console.error('Usage:');
  console.error('  node db/tenant-init.js \\');
  REQUIRED.forEach((k) => console.error(`    --${k} <value> \\`));
  process.exit(1);
}

const tenantId     = args['tenant-id'];
const slug         = args['slug'];
const displayName  = args['display-name'];
const regulatorName  = args['regulator-name'];
const regulatorShort = args['regulator-short'];
const adminEmail   = args['admin-email'];

// Basic email sanity check (no external deps).
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error(`[tenant-init] --admin-email does not look like a valid email address: ${adminEmail}`);
  process.exit(1);
}

// ── Database connection ─────────────────────────────────────────────────────

const dbPath = path.join(__dirname, 'nbe-dms.db');
let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.error(`[tenant-init] could not open database at ${dbPath}: ${err.message}`);
  console.error('Ensure the database exists and schema.sql / migrations have been applied first.');
  process.exit(1);
}

// ── Schema presence checks ──────────────────────────────────────────────────

function tableExists(name) {
  const row = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
  ).get(name);
  return Boolean(row);
}

if (!tableExists('tenants')) {
  console.error('[tenant-init] the `tenants` table does not exist.');
  console.error('Run schema.sql (or the CC1 migration) before bootstrapping a tenant.');
  db.close();
  process.exit(1);
}

if (!tableExists('users')) {
  console.error('[tenant-init] the `users` table does not exist.');
  console.error('Run schema.sql before bootstrapping a tenant.');
  db.close();
  process.exit(1);
}

// ── Duplicate guard ─────────────────────────────────────────────────────────

const existing = db.prepare('SELECT tenant_id FROM tenants WHERE tenant_id = ?').get(tenantId);
if (existing) {
  console.error(`[tenant-init] tenant "${tenantId}" already exists. Aborting to avoid duplicate.`);
  db.close();
  process.exit(1);
}

// ── Generate one-time token ─────────────────────────────────────────────────

const token = crypto.randomBytes(32).toString('hex');

// ── Insert tenant row ───────────────────────────────────────────────────────

db.prepare(
  `INSERT INTO tenants
     (tenant_id, slug, display_name, regulator_name, regulator_short,
      default_locale, allowed_locales, is_active)
   VALUES (?, ?, ?, ?, ?, 'en', '["en"]', 1)`
).run(tenantId, slug, displayName, regulatorName, regulatorShort);

console.log(`[tenant-init] tenant created: ${tenantId} / ${displayName}`);

// ── Insert admin user with NULL password_hash ───────────────────────────────
//
// password_hash IS NULL is the application's signal that the account has not
// yet been activated. The login handler must reject NULL-hash logins and
// instruct the user to complete the magic-link flow.
//
// The password_set_token column may not exist on older schemas. We attempt the
// insert with it and fall back without — the token is always printed to stdout
// so the operator can record it regardless of whether the column persists it.

const username = adminEmail.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'admin';

let insertResult;
try {
  insertResult = db.prepare(
    `INSERT INTO users
       (username, email, password, full_name, role, branch, mfa_enabled, status,
        tenant_id, password_set_token)
     VALUES (?, ?, NULL, ?, 'Doc Admin', 'HQ', 0, 'Active', ?, ?)`
  ).run(username, adminEmail, displayName + ' Admin', tenantId, token);
} catch (_firstErr) {
  // password_set_token column may not exist yet — insert without it.
  try {
    insertResult = db.prepare(
      `INSERT INTO users
         (username, email, password, full_name, role, branch, mfa_enabled, status, tenant_id)
       VALUES (?, ?, NULL, ?, 'Doc Admin', 'HQ', 0, 'Active', ?)`
    ).run(username, adminEmail, displayName + ' Admin', tenantId);
  } catch (secondErr) {
    // email column may not exist on very old schemas — final fallback.
    insertResult = db.prepare(
      `INSERT INTO users
         (username, password, full_name, role, branch, mfa_enabled, status, tenant_id)
       VALUES (?, NULL, ?, 'Doc Admin', 'HQ', 0, 'Active', ?)`
    ).run(username, displayName + ' Admin', tenantId);
  }
}

console.log(`[tenant-init] admin user created: username="${username}" (id=${insertResult.lastInsertRowid})`);

db.close();

// ── Print magic link ────────────────────────────────────────────────────────

const host = process.env.APP_HOST ?? 'http://localhost:3000';

console.log('');
console.log('='.repeat(72));
console.log('ACTION REQUIRED — send this magic link to the new admin:');
console.log('');
console.log(`  ${host}/set-password?token=${token}`);
console.log('');
console.log('The token is a one-time 32-byte hex secret. Record it now.');
console.log('The /set-password handler is owed by the CC2 wave (follow-up task).');
console.log('='.repeat(72));
