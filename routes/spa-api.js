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

// Everything below requires a logged-in session.
router.use(requireAuthJson);

router.use(require('./spa-api/stats'));
router.use(require('./spa-api/folders'));
router.use(require('./spa-api/documents'));
router.use(require('./spa-api/workflows'));
router.use(require('./spa-api/workflow-templates'));
router.use(require('./spa-api/document-types'));
router.use(require('./spa-api/alerts'));
router.use(require('./spa-api/search'));
router.use(require('./spa-api/indexing'));
router.use(require('./spa-api/reports'));
router.use(require('./spa-api/compliance'));
router.use(require('./spa-api/integrations'));
router.use(require('./spa-api/security'));
router.use(require('./spa-api/users'));
router.use(require('./spa-api/admin'));
router.use(require('./spa-api/ai'));
router.use(require('./spa-api/ai-glossary'));
router.use(require('./spa-api/docbrain'));
router.use(require('./spa-api/offline'));
router.use(require('./spa-api/cbs'));
router.use(require('./spa-api/aml-screening'));

module.exports = router;
