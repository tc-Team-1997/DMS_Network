const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function signPdf(docId, user) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) throw new Error('Document not found');
  if (doc.mime_type !== 'application/pdf') throw new Error('Only PDF documents can be signed');

  const filePath = path.join(__dirname, '..', 'uploads', doc.filename);
  const bytes = fs.readFileSync(filePath);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.getPages()[pdf.getPageCount() - 1];
  const { width } = page.getSize();

  const ts = new Date().toISOString();
  const certHash = crypto.createHash('sha256').update(bytes).update(user.username).update(ts).digest('hex').slice(0, 16);

  page.drawRectangle({ x: width - 220, y: 30, width: 200, height: 60, borderColor: rgb(0.18, 0.48, 0.30), borderWidth: 1.5, color: rgb(0.94, 0.98, 0.95) });
  page.drawText('DIGITALLY SIGNED', { x: width - 212, y: 72, size: 8, font, color: rgb(0.18, 0.48, 0.30) });
  page.drawText(user.full_name || user.username, { x: width - 212, y: 58, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(ts.slice(0, 19).replace('T', ' '), { x: width - 212, y: 46, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Cert: ' + certHash, { x: width - 212, y: 35, size: 6, font, color: rgb(0.4, 0.4, 0.4) });

  const signedBytes = await pdf.save();
  const newName = doc.filename.replace(/\.pdf$/i, `.signed.${Date.now()}.pdf`);
  fs.writeFileSync(path.join(__dirname, '..', 'uploads', newName), signedBytes);

  db.prepare('UPDATE documents SET filename=?, version=? WHERE id=?')
    .run(newName, incrementVersion(doc.version), docId);
  db.prepare('INSERT INTO signatures (doc_id, user_id, signer_name, certificate_hash) VALUES (?,?,?,?)')
    .run(docId, user.id, user.full_name || user.username, certHash);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?,?,?,?)')
    .run(user.id, 'SIGN', 'document', docId);

  return { certHash, filename: newName };
}

function incrementVersion(v) {
  if (!v) return 'v1.1';
  const m = v.match(/^v(\d+)\.(\d+)$/);
  if (!m) return 'v1.1';
  return `v${m[1]}.${parseInt(m[2]) + 1}`;
}

module.exports = { signPdf };
