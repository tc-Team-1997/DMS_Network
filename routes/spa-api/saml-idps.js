'use strict';
/**
 * SAML IdP admin — Users v2 (migration 0031).
 *
 * GET    /admin/users/saml-idps          — list IdPs for tenant
 * POST   /admin/users/saml-idps          — create IdP
 * PUT    /admin/users/saml-idps/:id      — update IdP
 * POST   /admin/users/saml-idps/:id/test — generate SAMLRequest XML for display
 */

const express = require('express');
const db      = require('../../db');
const { requireNamespacePermJson, tenantScope } = require('./_shared');
const { setConfig } = require('../../db/tenant-config');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

function publicIdp(row) {
  return {
    id:             row.id,
    tenant_id:      row.tenant_id,
    name:           row.name,
    metadata_xml:   row.metadata_xml,
    claim_map:      (() => { try { return JSON.parse(row.claim_map_json); } catch { return {}; } })(),
    enforce_only:   row.enforce_only === 1,
    is_active:      row.is_active === 1,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  };
}

function writeAudit({ userId, action, entityId, details, tenantId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
     VALUES (?, ?, 'saml_idp', ?, ?, ?, ?)`
  ).run(userId, action, entityId ?? null, details ? JSON.stringify(details) : null, tenantId ?? 'nbe',
    policyDecision !== null ? JSON.stringify(policyDecision) : null);
}

// ---------------------------------------------------------------------------
// GET /admin/users/saml-idps
// ---------------------------------------------------------------------------

router.get('/admin/users/saml-idps', requireNamespacePermJson('auth'), (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(
    `SELECT id, tenant_id, name, metadata_xml, claim_map_json,
            enforce_only, is_active, created_at, updated_at
     FROM saml_idps WHERE tenant_id = ? ORDER BY name`
  ).all(tenant);
  res.json(rows.map(publicIdp));
});

// ---------------------------------------------------------------------------
// POST /admin/users/saml-idps
// ---------------------------------------------------------------------------

router.post('/admin/users/saml-idps', requireNamespacePermJson('auth'), (req, res) => {
  const { name, metadata_xml, claim_map, enforce_only, is_active } = req.body ?? {};
  const tenant  = tenantScope(req);
  const actorId = req.session.user.id;

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  if (typeof metadata_xml !== 'string' || !metadata_xml.trim()) {
    return res.status(400).json({ error: 'metadata_xml_required' });
  }

  let claimMapJson = '{}';
  if (claim_map && typeof claim_map === 'object') {
    claimMapJson = JSON.stringify(claim_map);
  }

  try {
    const ins = db.prepare(
      `INSERT INTO saml_idps
         (tenant_id, name, metadata_xml, claim_map_json, enforce_only, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      tenant,
      name.trim(),
      metadata_xml.trim(),
      claimMapJson,
      enforce_only ? 1 : 0,
      is_active !== false ? 1 : 0,
    );

    writeAudit({ userId: actorId, action: 'SAML_IDP_CREATE', entityId: ins.lastInsertRowid, tenantId: tenant, policyDecision: buildPolicyDecision(req) });

    try {
      setConfig(tenant, '_user_meta', 'last_saml_config_at', new Date().toISOString(), {
        actorUserId: actorId,
        reason: `SAML IdP created: ${name.trim()} in tenant ${tenant}`,
      });
    } catch (_) {}

    const row = db.prepare('SELECT * FROM saml_idps WHERE id = ?').get(ins.lastInsertRowid);
    res.status(201).json(publicIdp(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'name_taken' });
    }
    res.status(500).json({ error: 'insert_failed', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/users/saml-idps/:id
// ---------------------------------------------------------------------------

router.put('/admin/users/saml-idps/:id', requireNamespacePermJson('auth'), (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM saml_idps WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const tenant  = tenantScope(req);
  const actorId = req.session.user.id;
  const body    = req.body ?? {};
  const sets    = [];
  const vals    = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); vals.push(body.name.trim());
  }
  if (typeof body.metadata_xml === 'string' && body.metadata_xml.trim()) {
    sets.push('metadata_xml = ?'); vals.push(body.metadata_xml.trim());
  }
  if (body.claim_map !== undefined) {
    const cm = body.claim_map && typeof body.claim_map === 'object'
      ? JSON.stringify(body.claim_map) : '{}';
    sets.push('claim_map_json = ?'); vals.push(cm);
  }
  if ('enforce_only' in body) {
    sets.push('enforce_only = ?'); vals.push(body.enforce_only ? 1 : 0);
  }
  if ('is_active' in body) {
    sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  db.prepare(`UPDATE saml_idps SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  writeAudit({ userId: actorId, action: 'SAML_IDP_UPDATE', entityId: id,
               details: Object.keys(body), tenantId: tenant, policyDecision: buildPolicyDecision(req) });

  try {
    setConfig(tenant, '_user_meta', 'last_saml_config_at', new Date().toISOString(), {
      actorUserId: actorId,
      reason: `SAML IdP updated: id=${id} in tenant ${tenant}`,
    });
  } catch (_) {}

  const updated = db.prepare('SELECT * FROM saml_idps WHERE id = ?').get(id);
  res.json(publicIdp(updated));
});

// ---------------------------------------------------------------------------
// POST /admin/users/saml-idps/:id/test
// Returns the SAMLRequest XML that would be sent to the IdP.
// Does NOT make any outbound HTTP request — safe in airgapped environments.
// The approved deviation: test-SSO shows request XML; no live IdP roundtrip.
// ---------------------------------------------------------------------------

router.post('/admin/users/saml-idps/:id/test', requireNamespacePermJson('auth'), (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM saml_idps WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const tenant  = tenantScope(req);
  const actorId = req.session.user.id;

  // Extract entityID + SSO URL from metadata XML (basic regex — not a full parser).
  const entityIdMatch = row.metadata_xml.match(/entityID="([^"]+)"/);
  const ssoUrlMatch   = row.metadata_xml.match(/<(?:[^:>]+:)?SingleSignOnService[^>]+Location="([^"]+)"/);

  const idpEntityId = entityIdMatch ? entityIdMatch[1] : '(not found in XML)';
  const ssoUrl      = ssoUrlMatch   ? ssoUrlMatch[1]   : '(not found in XML)';
  const claimMap    = (() => { try { return JSON.parse(row.claim_map_json); } catch { return {}; } })();

  const issuer    = process.env.SAML_ISSUER || 'docmanager-sp';
  const now       = new Date().toISOString();
  const requestId = `_${require('crypto').randomBytes(10).toString('hex')}`;
  const acsUrl    = `${req.protocol}://${req.get('host')}/sso/saml/callback`;

  const samlRequestXml = [
    `<samlp:AuthnRequest`,
    `  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
    `  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
    `  ID="${requestId}"`,
    `  Version="2.0"`,
    `  IssueInstant="${now}"`,
    `  Destination="${ssoUrl}"`,
    `  AssertionConsumerServiceURL="${acsUrl}"`,
    `  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `  <saml:Issuer>${issuer}</saml:Issuer>`,
    `</samlp:AuthnRequest>`,
  ].join('\n');

  writeAudit({ userId: actorId, action: 'SAML_IDP_TEST', entityId: id, tenantId: tenant, policyDecision: buildPolicyDecision(req) });

  res.json({
    idp_entity_id:    idpEntityId,
    sso_url:          ssoUrl,
    sp_issuer:        issuer,
    acs_url:          acsUrl,
    claim_map:        claimMap,
    saml_request_xml: samlRequestXml,
    note: 'This is the SAMLRequest the SP would send. No outbound request was made.',
  });
});

module.exports = router;
