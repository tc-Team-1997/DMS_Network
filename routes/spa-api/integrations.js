/**
 * Integration marketplace — adapter catalogue. Reads the capability
 * matrix from docs/INTEGRATION_STRATEGY.md (hard-coded here for now)
 * and the real-time health from the Python integrations registry once
 * it's wired up. Status values: live | sandbox | mock | planned.
 */
const express = require('express');
const { pyCall, requirePermJson } = require('./_shared');

const router = express.Router();

// Ordered to match the roadmap waves. `status` reflects shipping-today,
// not target state. When a real adapter reaches sandbox, flip to
// 'sandbox'; when it's certified with a bank, flip to 'live'.
const CATALOGUE = [
  { id: 'temenos_t24',      name: 'Temenos T24',        category: 'CBS',        status: 'mock',    wave: 'Q4 2026' },
  { id: 'flexcube',         name: 'Oracle FLEXCUBE',    category: 'CBS',        status: 'planned', wave: 'Q4 2026' },
  { id: 'finastra_fusion',  name: 'Finastra Fusion',    category: 'CBS',        status: 'planned', wave: 'Q4 2026' },
  { id: 'mambu',            name: 'Mambu',              category: 'CBS',        status: 'planned', wave: 'Q1 2027' },
  { id: 'thought_machine',  name: 'Thought Machine',    category: 'CBS',        status: 'planned', wave: 'Q1 2027' },
  { id: 'oracle_banking',   name: 'Oracle Banking',     category: 'CBS',        status: 'planned', wave: 'Q1 2027' },
  { id: 'fis_profile',      name: 'FIS Profile',        category: 'CBS',        status: 'planned', wave: 'Q1 2027' },
  { id: 'salesforce_fs',    name: 'Salesforce FS Cloud',category: 'CRM',        status: 'planned', wave: 'Q2 2027' },
  { id: 'docusign',         name: 'DocuSign',           category: 'Signature',  status: 'planned', wave: 'Q2 2027' },
  { id: 'ms_fabric',        name: 'Microsoft Fabric',   category: 'Analytics',  status: 'planned', wave: 'Q2 2027' },
];

router.get('/integrations', requirePermJson('admin'), async (_req, res) => {
  // Best-effort health probe against Python's /api/v1/integrations/health
  // if the router is wired; fall back to catalogue-only.
  let health = {};
  try {
    const data = await pyCall('/api/v1/integrations/health');
    if (data && typeof data === 'object') health = data;
  } catch { /* no Python endpoint yet — catalogue view only */ }

  res.json({
    adapters: CATALOGUE.map((a) => ({
      ...a,
      health: health[a.id] ?? null,
    })),
    note: 'Catalogue is a preview. Sandbox credentials are provisioned per tenant during onboarding.',
  });
});

module.exports = router;
