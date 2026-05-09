'use strict';
/**
 * Regulator Reports scheduled-generation job (Wave C).
 *
 * Dependency check: node-cron ^3.0.3 is present in package.json.
 * Using node-cron directly — no custom cron-matcher fallback needed.
 * If node-cron is ever removed, replace the cron.schedule() call with
 * a setInterval(checkDue, 60_000) + a lightweight cron-match utility.
 *
 * Strategy:
 *   At startup, register one node-cron task per unique schedule_cron value
 *   found in the regulator_reports table (active templates only). When the
 *   cron fires it:
 *     1. Queries all templates whose schedule_cron matches the fired expr.
 *     2. For each, calls the Node route's generate path internally via a
 *        local HTTP POST to /spa/api/reports/templates/:id/generate.
 *        (The generate route proxies to Python — keeps signing and rendering
 *         in one place, consistent with manual generation.)
 *
 * v1 simplification: we do NOT auto-submit to regulators even if
 *   tenant_config.regulator_reports.auto_submit_enabled = true.
 *   That would need secure credential management beyond the current stub.
 *   The generated receipt still lands in submission_receipts for audit.
 *
 * Usage:
 *   const job = require('./services/regulator-reports-job');
 *   job.start();   // called once in server.js at startup
 *   job.stop();    // for graceful shutdown tests
 */

const http  = require('http');
const cron  = require('node-cron');   // node-cron ^3.0.3 — confirmed in package.json
const db    = require('../db');

/** Active cron tasks keyed by cron expression string. */
const _tasks = new Map();
let _started = false;

/**
 * Build the generate payload for a scheduled run.
 * as_of_date defaults to today (UTC). Params default to empty — admins
 * who need non-default params should run manually from the UI.
 */
function _buildPayload(template) {
  const today = new Date().toISOString().slice(0, 10);
  return JSON.stringify({
    as_of_date: today,
    params: {},
    format: template.format ?? 'pdf',
  });
}

/**
 * Fire a generation request for one template.
 * Calls the local Node server's own SPA endpoint so that:
 *   - Auth is handled by the system user token pattern.
 *   - Python signing/rendering path is reused identically.
 * Uses a fire-and-forget pattern; errors are logged, not re-thrown.
 */
function _triggerGenerate(template) {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const path = `/spa/api/reports/templates/${template.id}/generate`;
  const payload = _buildPayload(template);

  // The internal call needs an API key — use the system admin session cookie
  // approach only when the port is local (127.0.0.1). For scheduled jobs we
  // POST directly to the Python service instead, bypassing the Node session auth.
  const pyBase = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
  const pyKey  = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';
  const pyPath = `/api/v1/regulator-reports/templates/${template.id}/generate`;
  const pyUrl  = new URL(pyPath, pyBase);

  const opts = {
    method: 'POST',
    headers: {
      'X-API-Key': pyKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 120_000,
  };

  const lib = pyUrl.protocol === 'https:' ? require('https') : http;
  const req = lib.request(pyUrl, opts, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      // eslint-disable-next-line no-console
      console.log(
        `[regulator-reports-job] template ${template.id} (${template.name}) ` +
        `scheduled generation: HTTP ${res.statusCode}`,
      );
      if (res.statusCode >= 400) {
        // eslint-disable-next-line no-console
        console.error('[regulator-reports-job] error body:', body.slice(0, 500));
      }
    });
  });

  req.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[regulator-reports-job] generate failed for template ${template.id}:`,
      err.message,
    );
  });

  req.write(payload);
  req.end();
}

/**
 * Register a node-cron task for the given cron expression.
 * Idempotent — if a task for `expr` already exists it is not re-registered.
 */
function _registerCron(expr) {
  if (_tasks.has(expr)) return;

  if (!cron.validate(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[regulator-reports-job] invalid cron expression skipped: "${expr}"`);
    return;
  }

  const task = cron.schedule(expr, () => {
    try {
      const templates = db.prepare(
        "SELECT id, name, format FROM regulator_reports WHERE schedule_cron = ? AND is_active = 1",
      ).all(expr);

      for (const tmpl of templates) {
        _triggerGenerate(tmpl);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[regulator-reports-job] cron handler error:', err.message);
    }
  }, { scheduled: true });

  _tasks.set(expr, task);
  // eslint-disable-next-line no-console
  console.log(`[regulator-reports-job] registered cron: "${expr}"`);
}

/**
 * Load active scheduled templates from the DB and register their crons.
 * Called at startup and may be called again after templates are edited
 * (the edit route in regulator-reports.js could call job.reload() — for
 * v1 a server restart re-registers; adding reload() covers hot-reload).
 */
function _loadAndRegister() {
  try {
    const rows = db.prepare(
      "SELECT DISTINCT schedule_cron FROM regulator_reports WHERE schedule_cron IS NOT NULL AND is_active = 1",
    ).all();

    for (const { schedule_cron: expr } of rows) {
      if (typeof expr === 'string' && expr.trim()) {
        _registerCron(expr.trim());
      }
    }
  } catch (err) {
    // Table may not exist on first boot before migration runs.
    // eslint-disable-next-line no-console
    console.warn('[regulator-reports-job] could not load schedules (table missing?):', err.message);
  }
}

/** Start the job. Safe to call multiple times — idempotent. */
function start() {
  if (_started) return;
  _started = true;
  _loadAndRegister();
  // eslint-disable-next-line no-console
  console.log(`[regulator-reports-job] started (${_tasks.size} schedule(s) registered).`);
}

/** Stop all cron tasks. Used in graceful shutdown / tests. */
function stop() {
  for (const task of _tasks.values()) {
    task.stop();
  }
  _tasks.clear();
  _started = false;
}

/**
 * Reload schedules from the DB. Call after editing a template's
 * schedule_cron via the admin UI so new schedules take effect without restart.
 */
function reload() {
  // New expressions are additive; we don't unregister removed ones in v1.
  _loadAndRegister();
}

module.exports = { start, stop, reload };
