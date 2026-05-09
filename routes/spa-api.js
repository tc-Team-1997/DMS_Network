/**
 * SPA-facing JSON API for apps/web. All routes are session-authenticated
 * via the same express-session cookie used by the EJS app — no tokens in
 * localStorage. RBAC mirrors services/rbac.js.
 *
 * Mounted at /spa/api in server.js. Per-feature handlers live in
 * routes/spa-api/<feature>.js; this file is just the composition root.
 */
const express = require('express');
const { requireAuthJson } = require('./spa-api/_shared');

const router = express.Router();

// Public — no session required.
// New canonical paths: /spa/api/auth/*
router.use('/auth', require('./spa-api/auth'));
// Legacy aliases kept for backward-compat with existing SPA calls to
// /spa/api/login, /spa/api/logout, /spa/api/me.
router.use(require('./spa-api/auth'));
// Anonymous tenant branding endpoint used by the login page before auth.
router.use(require('./spa-api/tenant-public'));

// Everything below requires a logged-in session.
router.use(requireAuthJson);
// Tenant-switch endpoint (requires session; returns 403 until Wave B Users-v2).
router.use(require('./spa-api/me-switch-tenant'));

router.use(require('./spa-api/stats'));
router.use(require('./spa-api/folders'));
router.use(require('./spa-api/documents'));
router.use(require('./spa-api/workflows'));
router.use(require('./spa-api/workflow-templates'));
router.use(require('./spa-api/workflow-template-versions'));
router.use(require('./spa-api/document-types'));
router.use(require('./spa-api/doctype-versions'));
router.use(require('./spa-api/alerts'));
router.use(require('./spa-api/search'));
router.use(require('./spa-api/indexing'));
router.use(require('./spa-api/reports'));
router.use(require('./spa-api/compliance'));
router.use(require('./spa-api/integrations'));
router.use(require('./spa-api/security'));
router.use(require('./spa-api/users'));
router.use(require('./spa-api/saml-idps'));
router.use(require('./spa-api/admin'));
router.use(require('./spa-api/ai'));
router.use(require('./spa-api/ai-glossary'));
router.use(require('./spa-api/docbrain'));
router.use(require('./spa-api/offline'));
router.use(require('./spa-api/sync'));
router.use(require('./spa-api/cbs'));
router.use(require('./spa-api/aml-screening'));
router.use(require('./spa-api/worm'));
router.use(require('./spa-api/legal-holds'));
router.use(require('./spa-api/redaction'));
router.use(require('./spa-api/annotations'));
router.use(require('./spa-api/face-match'));
router.use(require('./spa-api/translate'));
router.use(require('./spa-api/admin-config'));
router.use(require('./spa-api/admin-tenants'));
router.use(require('./spa-api/abac'));
router.use(require('./spa-api/dashboard'));
router.use(require('./spa-api/customer-360'));

module.exports = router;
