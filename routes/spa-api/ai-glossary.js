/**
 * AI Engine glossary — session-authenticated proxy to the Python service.
 * Read access for anyone with the `view` permission; writes restricted to
 * the `admin` permission (Doc Admin).
 */
const express = require('express');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

router.get('/ai/glossary', requirePermJson('view'), async (req, res) => {
  const tenant_id = tenantScope(req);
  const { category, approved, query, limit } = req.query;
  const qs = new URLSearchParams({ tenant_id });
  if (category) qs.set('category', String(category));
  if (approved === 'true' || approved === 'false') qs.set('approved', String(approved));
  if (query) qs.set('query', String(query));
  if (limit) qs.set('limit', String(limit));
  try {
    const data = await pyCall(`/api/v1/docbrain/glossary?${qs.toString()}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_list_failed', detail: err.message });
  }
});

router.get('/ai/glossary/:id', requirePermJson('view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });
  try {
    const data = await pyCall(
      `/api/v1/docbrain/glossary/${id}?tenant_id=${encodeURIComponent(tenantScope(req))}`,
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_get_failed', detail: err.message });
  }
});

router.post('/ai/glossary', requirePermJson('admin'), async (req, res) => {
  const tenant_id = tenantScope(req);
  const created_by = req.session.user?.id ?? null;
  try {
    const data = await pyCall(
      `/api/v1/docbrain/glossary?tenant_id=${encodeURIComponent(tenant_id)}&created_by=${encodeURIComponent(created_by ?? '')}`,
      { method: 'POST', body: req.body },
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_create_failed', detail: err.message, data: err.data });
  }
});

router.patch('/ai/glossary/:id', requirePermJson('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });
  try {
    const data = await pyCall(
      `/api/v1/docbrain/glossary/${id}?tenant_id=${encodeURIComponent(tenantScope(req))}`,
      { method: 'PATCH', body: req.body },
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_update_failed', detail: err.message, data: err.data });
  }
});

router.delete('/ai/glossary/:id', requirePermJson('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });
  try {
    const data = await pyCall(
      `/api/v1/docbrain/glossary/${id}?tenant_id=${encodeURIComponent(tenantScope(req))}`,
      { method: 'DELETE' },
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_delete_failed', detail: err.message });
  }
});

router.post('/ai/glossary/regenerate', requirePermJson('admin'), async (req, res) => {
  const tenant_id = tenantScope(req);
  const overwrite_auto = req.body?.overwrite_auto !== false;
  try {
    const data = await pyCall(
      '/api/v1/docbrain/glossary/regenerate',
      { method: 'POST', body: { tenant_id, overwrite_auto }, timeout: 300_000 },
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_regenerate_failed', detail: err.message });
  }
});

router.post('/ai/glossary/reindex', requirePermJson('admin'), async (req, res) => {
  try {
    const data = await pyCall(
      `/api/v1/docbrain/glossary/reindex?tenant_id=${encodeURIComponent(tenantScope(req))}`,
      { method: 'POST', timeout: 300_000 },
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_reindex_failed', detail: err.message });
  }
});

router.get('/ai/glossary/_meta/schema', requirePermJson('admin'), async (_req, res) => {
  try {
    const data = await pyCall('/api/v1/docbrain/glossary/_meta/schema');
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'glossary_schema_failed', detail: err.message });
  }
});

module.exports = router;
