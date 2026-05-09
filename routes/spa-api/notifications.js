'use strict';
/**
 * In-app notification feed + admin test-send — Wave C Notifications (F#23).
 *
 * Endpoints:
 *   GET    /spa/api/notifications           — paginated feed for current user
 *   POST   /spa/api/notifications/:id/mark-read  — mark one notification read
 *   POST   /spa/api/notifications/mark-all-read  — bulk mark all read
 *   POST   /spa/api/admin/notifications/test-send — Doc Admin only; render + send
 *
 * All routes require session auth.  test-send additionally requires Doc Admin role.
 */

const express = require('express');
const db      = require('../../db');
const { requireAuthJson, requirePermJson, tenantScope } = require('./_shared');
const { send, interpolate } = require('../../services/notify');
const { getConfig }          = require('../../db/tenant-config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Sample vars for test-send preview
// ---------------------------------------------------------------------------

const SAMPLE_VARS = {
  expiry_alert:       { count: '3', doc_type: 'Passport', band: '30 days' },
  workflow_assigned:  { ref_code: 'WF-DEMO-001', title: 'KYC Review' },
  aml_hit:            { customer_cid: 'CID-DEMO-9999', hit_count: '2' },
  user_invite:        { inviter_name: 'Admin User', role: 'Maker', invite_link: 'https://example.com/set-password?token=DEMO', ttl_hours: '168' },
  dsar_completed:     { request_id: 'DSAR-DEMO-001' },
};

// ---------------------------------------------------------------------------
// GET /spa/api/notifications — paginated in-app feed
// ---------------------------------------------------------------------------

router.get('/notifications', requireAuthJson, (req, res) => {
  const user = req.session.user;
  const limit  = Math.min(parseInt(String(req.query.limit  ?? 50), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? 0),  10) || 0;
  const unreadOnly = req.query.unread === 'true';

  let sql = `SELECT id, channel, subject, body, status, sent_at, is_read, read_at, event_type, template_id
             FROM notifications
             WHERE user_id = ?`;
  const params = [user.id];

  if (unreadOnly) {
    sql += ' AND is_read = 0';
  }

  sql += ' ORDER BY sent_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  const unreadCount = db.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0"
  ).get(user.id).c;

  res.json({ items: rows, unread_count: unreadCount, limit, offset });
});

// ---------------------------------------------------------------------------
// POST /spa/api/notifications/mark-all-read  (must be before /:id route)
// ---------------------------------------------------------------------------

router.post('/notifications/mark-all-read', requireAuthJson, (req, res) => {
  const user = req.session.user;
  const now  = new Date().toISOString();
  db.prepare(
    "UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0"
  ).run(now, user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /spa/api/notifications/:id/mark-read
// ---------------------------------------------------------------------------

router.post('/notifications/:id/mark-read', requireAuthJson, (req, res) => {
  const user = req.session.user;
  const id   = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  // Verify ownership before updating.
  const row = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  db.prepare("UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/notifications/test-send
// ---------------------------------------------------------------------------

router.post(
  '/admin/notifications/test-send',
  requireAuthJson,
  requirePermJson('admin'),
  async (req, res) => {
    const user     = req.session.user;
    const tenantId = tenantScope(req);
    const { template_id: templateId, channel } = req.body;

    if (!templateId || typeof templateId !== 'string') {
      return res.status(400).json({ error: 'template_id required' });
    }

    // Resolve template.
    const tmplSubject = getConfig(tenantId, 'notifications', `templates.${templateId}.subject`, null);
    const tmplBody    = getConfig(tenantId, 'notifications', `templates.${templateId}.body`,    null);

    if (!tmplSubject || !tmplBody) {
      return res.status(404).json({ error: `template '${templateId}' not found in tenant_config` });
    }

    const sampleVars = SAMPLE_VARS[templateId] ?? {};
    const subject = interpolate(tmplSubject, sampleVars);
    const body    = interpolate(tmplBody,    sampleVars);

    // Send to admin's own account.
    try {
      const result = await send({
        tenantId,
        userId:          user.id,
        eventType:       templateId,
        vars:            sampleVars,
        channelOverride: channel ?? null,
        subject,
        body,
      });

      // Audit the test send.
      db.prepare(
        `INSERT INTO audit_log (user_id, action, entity, details, tenant_id)
         VALUES (?, 'NOTIFICATION_TEST_SEND', 'notification', ?, ?)`
      ).run(
        user.id,
        JSON.stringify({ template_id: templateId, channel: channel ?? 'resolved', ok: true }),
        tenantId,
      );

      res.json({ ok: true, template_id: templateId, subject, body, results: result.results, skipped: result.skipped });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
