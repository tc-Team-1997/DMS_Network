const Tesseract = require('tesseract.js');
const path = require('path');
const db = require('../db');

async function runOcr(docId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return;
  if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
    db.prepare('UPDATE documents SET ocr_text = ?, ocr_confidence = ? WHERE id = ?')
      .run('[Non-image file - OCR skipped]', null, docId);
    return;
  }
  const filePath = path.join(__dirname, '..', 'uploads', doc.filename);
  try {
    const { data } = await Tesseract.recognize(filePath, 'eng', { logger: () => {} });
    db.prepare('UPDATE documents SET ocr_text = ?, ocr_confidence = ? WHERE id = ?')
      .run(data.text, data.confidence, docId);
    return { text: data.text, confidence: data.confidence };
  } catch (err) {
    db.prepare('UPDATE documents SET ocr_text = ? WHERE id = ?')
      .run(`[OCR error: ${err.message}]`, docId);
  }
}

module.exports = { runOcr };
