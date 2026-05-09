'use strict';
/**
 * Unified notification send() — Wave C Notifications (F#23).
 *
 * Public API:
 *   send({ tenantId, userId, eventType, vars?, channelOverride?, subject?, body? })
 *     → Promise<{ results: Record<channel, {ok,error?}>, skipped: string[] }>
 *
 *   broadcastByRole(tenantId, role, eventType, vars?)
 *     → Promise<void>
 *
 *   notify(userId, channel, subject, body)   ← @deprecated backward-compat shim
 *   broadcast(role, channel, subject, body)  ← @deprecated backward-compat shim
 *
 * Send pipeline (per channel):
 *   1. Check channels.<channel>.enabled in tenant_config.
 *   2. Check throttle via notification-throttle.js.
 *   3. Render template: tenant_config notifications.templates.<eventType>.{subject,body}
 *      with {{var}} interpolation over `vars`. Falls back to raw subject/body when
 *      no template row exists (shim path only).
 *   4. Dispatch to channel provider.
 *   5. Write to notifications table (in-app feed).
 *   6. Audit to audit_log.
 */

const nodemailer = require('nodemailer');
const db         = require('../db');
const { getConfig }       = require('../db/tenant-config');
const { checkAndConsume } = require('./notification-throttle');
const { sendSms }         = require('./sms');

// ---------------------------------------------------------------------------
// Template interpolation — {{var}} substitution, no external deps.
// ---------------------------------------------------------------------------

/**
 * Replace all {{key}} placeholders in `template` with values from `vars`.
 * Unknown keys are replaced with an empty string.
 *
 * @param {string} template
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v !== undefined && v !== null ? String(v) : '';
  });
}

// ---------------------------------------------------------------------------
// SMTP transport factory (reads tenant_config per call — supports hot config).
// ---------------------------------------------------------------------------

function _buildTransport(tenantId) {
  const host = getConfig(tenantId, 'notifications', 'smtp_host', null);
  if (!host) return nodemailer.createTransport({ jsonTransport: true });
  const port    = getConfig(tenantId, 'notifications', 'smtp_port', 587);
  const user    = getConfig(tenantId, 'notifications', 'smtp_user', null);
  const pass    = getConfig(tenantId, 'notifications', 'smtp_pass', null);
  const tlsMode = getConfig(tenantId, 'notifications', 'smtp_tls', 'starttls');
  return nodemailer.createTransport({
    host,
    port,
    secure: tlsMode === 'ssl',
    auth: user ? { user, pass: pass ?? '' } : undefined,
  });
}

// ---------------------------------------------------------------------------
// Resolve channels for an eventType
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 * @param {string} eventType
 * @param {string|null} channelOverride
 * @returns {string[]}
 */
function _resolveChannels(tenantId, eventType, channelOverride) {
  if (channelOverride) return [channelOverride];
  const raw = getConfig(tenantId, 'notifications', `templates.${eventType}.channels`, null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }
  return ['email', 'in_app'];
}

// ---------------------------------------------------------------------------
// Throttle config helper
// ---------------------------------------------------------------------------

/**
 * @param {string} tenantId
 * @param {string} channel
 * @returns {{ perUserPerMinute: number, perTenantPerMinute: number, burst: number }}
 */
function _throttleConfig(tenantId, channel) {
  const cfgChannel = (channel === 'whatsapp' || channel === 'push') ? 'sms' : channel;
  return {
    perUserPerMinute:   getConfig(tenantId, 'notifications', `${cfgChannel}.throttle.per_user_per_minute`,   5),
    perTenantPerMinute: getConfig(tenantId, 'notifications', `${cfgChannel}.throttle.per_tenant_per_minute`, 100),
    burst:              getConfig(tenantId, 'notifications', `${cfgChannel}.throttle.burst`,                 10),
  };
}

// ---------------------------------------------------------------------------
// Channel dispatch
// ---------------------------------------------------------------------------

/**
 * @param {string} channel
 * @param {string} tenantId
 * @param {{ id: number, email: string|null, phone?: string|null }} user
 * @param {string} subject
 * @param {string} body
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function _dispatch(channel, tenantId, user, subject, body) {
  if (channel === 'email') {
    if (!user.email) return { ok: false, error: 'no email address for user' };
    const from = getConfig(tenantId, 'notifications', 'smtp_from', 'noreply@docmanager.local');
    try {
      const transport = _buildTransport(tenantId);
      await transport.sendMail({ from, to: user.email, subject, text: body });
      console.log(`[notify:email] -> ${user.email}: ${subject}`);
      return { ok: true };
    } catch (err) {
      console.error(`[notify:email] FAILED -> ${user.email}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  if (channel === 'sms') {
    if (!user.phone) return { ok: false, error: 'no phone number for user' };
    try {
      await sendSms(user.phone, `[${subject}] ${body}`, user.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  if (channel === 'whatsapp') {
    console.log(`[notify:whatsapp] stub -> user ${user.id}: ${subject}`);
    return { ok: false, error: 'whatsapp provider not configured' };
  }

  if (channel === 'push') {
    console.log(`[notify:push] stub -> user ${user.id}: ${subject}`);
    return { ok: false, error: 'push provider not configured' };
  }

  if (channel === 'in_app') {
    // in_app delivery is the DB write in send(); dispatch itself is always ok.
    return { ok: true };
  }

  return { ok: false, error: `unknown channel '${channel}'` };
}

// ---------------------------------------------------------------------------
// Core unified send()
// ---------------------------------------------------------------------------

/**
 * Send a notification via unified pipeline.
 *
 * @param {object} opts
 * @param {string}  opts.tenantId
 * @param {number}  opts.userId
 * @param {string}  opts.eventType
 * @param {Record<string, string|number>} [opts.vars]
 * @param {string|null} [opts.channelOverride]
 * @param {string|null} [opts.subject]  — raw subject (shim path, bypasses template lookup)
 * @param {string|null} [opts.body]     — raw body (shim path, bypasses template lookup)
 * @returns {Promise<{results: Record<string, {ok: boolean, error?: string}>, skipped: string[]}>}
 */
async function send({
  tenantId,
  userId,
  eventType,
  vars = {},
  channelOverride = null,
  subject: rawSubject = null,
  body: rawBody = null,
}) {
  /** @type {Record<string, {ok: boolean, error?: string}>} */
  const results = {};
  /** @type {string[]} */
  const skipped = [];

  const user = db.prepare(
    'SELECT id, username, email, role, tenant_id FROM users WHERE id = ?'
  ).get(userId);
  if (!user) {
    console.warn(`[notify] user ${userId} not found — skipping`);
    return { results, skipped: ['user_not_found'] };
  }

  const channels = _resolveChannels(tenantId, eventType, channelOverride);

  for (const channel of channels) {
    // 1. Channel-enabled check.
    const defaultEnabled = channel === 'email' || channel === 'in_app';
    const enabled = getConfig(tenantId, 'notifications', `channels.${channel}.enabled`, defaultEnabled);
    if (!enabled) {
      skipped.push(`${channel}:disabled`);
      continue;
    }

    // 2. Throttle check (in_app not throttled — it is just a DB write).
    if (channel !== 'in_app') {
      const tCfg = _throttleConfig(tenantId, channel);
      const throttle = await checkAndConsume(channel, userId, tenantId, tCfg);
      if (!throttle.allowed) {
        skipped.push(`${channel}:throttled`);
        console.warn(`[notify] throttled channel=${channel} userId=${userId} tenantId=${tenantId}`);
        continue;
      }
    }

    // 3. Render template or fall back to raw shim values.
    let subject = rawSubject ?? `[DMS] ${eventType}`;
    let body    = rawBody    ?? '';
    const tmplSubject = getConfig(tenantId, 'notifications', `templates.${eventType}.subject`, null);
    const tmplBody    = getConfig(tenantId, 'notifications', `templates.${eventType}.body`,    null);
    if (tmplSubject) subject = interpolate(tmplSubject, vars);
    if (tmplBody)    body    = interpolate(tmplBody,    vars);

    // 4. Dispatch.
    const dispatchResult = await _dispatch(channel, tenantId, user, subject, body);

    // 5. Write to notifications table (in-app feed + history).
    const status = dispatchResult.ok ? 'sent' : `failed:${dispatchResult.error ?? 'unknown'}`;
    try {
      db.prepare(
        `INSERT INTO notifications
           (user_id, channel, subject, body, status, is_read, event_type, template_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(userId, channel, subject, body, status, eventType, eventType);
    } catch (dbErr) {
      console.error('[notify] DB insert failed:', dbErr.message);
    }

    // 6. Audit.
    try {
      db.prepare(
        `INSERT INTO audit_log (user_id, action, entity, details, tenant_id)
         VALUES (?, 'NOTIFICATION_SENT', 'notification', ?, ?)`
      ).run(
        userId,
        JSON.stringify({ channel, event_type: eventType, ok: dispatchResult.ok }),
        tenantId,
      );
    } catch { /* best-effort */ }

    results[channel] = dispatchResult;
  }

  return { results, skipped };
}

// ---------------------------------------------------------------------------
// Broadcast helper
// ---------------------------------------------------------------------------

/**
 * Send to all active users with a given role in the tenant.
 *
 * @param {string} tenantId
 * @param {string} role
 * @param {string} eventType
 * @param {Record<string, string|number>} [vars]
 * @returns {Promise<void>}
 */
async function broadcastByRole(tenantId, role, eventType, vars = {}) {
  const users = db.prepare(
    "SELECT id FROM users WHERE role = ? AND status = 'Active' AND tenant_id = ?"
  ).all(role, tenantId);
  for (const u of users) {
    try {
      await send({ tenantId, userId: u.id, eventType, vars });
    } catch (err) {
      console.error(`[notify] broadcastByRole error userId=${u.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compat shims — @deprecated
// ---------------------------------------------------------------------------

/**
 * @deprecated Use send() instead.
 * @param {number} userId
 * @param {string} channel
 * @param {string} subject
 * @param {string} body
 */
async function notify(userId, channel, subject, body) {
  const row = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId);
  const tenantId = row?.tenant_id ?? 'nbe';
  return send({ tenantId, userId, eventType: 'legacy', channelOverride: channel, subject, body });
}

/**
 * @deprecated Use broadcastByRole() instead.
 * @param {string} role
 * @param {string} channel
 * @param {string} subject
 * @param {string} body
 */
function broadcast(role, channel, subject, body) {
  const users = db.prepare("SELECT id, tenant_id FROM users WHERE role = ? AND status = 'Active'").all(role);
  users.forEach((u) => {
    notify(u.id, channel, subject, body).catch((err) =>
      console.error(`[notify:broadcast] userId=${u.id}:`, err.message)
    );
  });
}

module.exports = { send, broadcastByRole, notify, broadcast, interpolate };
