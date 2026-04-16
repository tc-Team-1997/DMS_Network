/**
 * Proxy to Python FastAPI microservice (OCR / duplicates / integrations / dashboard).
 * Mount at /py in server.js:
 *     app.use('/py', requireAuth, require('./routes/py-proxy'));
 *
 * Env:
 *   PYTHON_SERVICE_URL  (default http://localhost:8000)
 *   PYTHON_SERVICE_KEY  (default dev-key-change-me)
 */
const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const router = express.Router();

const TARGET = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const API_KEY = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';

router.all('*', (req, res) => {
  const target = new URL(req.originalUrl.replace(/^\/py/, ''), TARGET);
  const lib = target.protocol === 'https:' ? https : http;

  const headers = { ...req.headers, 'x-api-key': API_KEY, host: target.host };
  delete headers['content-length'];

  const proxyReq = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'python_service_unreachable', detail: err.message });
  });

  req.pipe(proxyReq);
});

module.exports = router;
