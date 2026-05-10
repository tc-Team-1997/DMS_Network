#!/usr/bin/env node
/* i18n parity check — fails CI if any en.json key is missing in dz.json
   or if a dz value is byte-identical to en (without [DZ-PENDING] marker). */
'use strict';

const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'en.json')));
const dz = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'dz.json')));

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, key));
  }
  return out;
}

const enFlat = flatten(en);
const dzFlat = flatten(dz);

const missing = [];
const identical = [];
for (const key of Object.keys(enFlat)) {
  if (!(key in dzFlat)) missing.push(key);
  else if (enFlat[key] === dzFlat[key] && !String(dzFlat[key]).startsWith('[DZ-PENDING]')) {
    identical.push(key);
  }
}

if (missing.length || identical.length) {
  if (missing.length) {
    console.error('Missing dz.json keys:');
    missing.forEach((k) => console.error('  -', k));
  }
  if (identical.length) {
    console.error('Byte-identical (en === dz) without [DZ-PENDING]:');
    identical.forEach((k) => console.error('  -', k));
  }
  process.exit(1);
}

console.log(`i18n parity OK — ${Object.keys(enFlat).length} keys checked.`);
