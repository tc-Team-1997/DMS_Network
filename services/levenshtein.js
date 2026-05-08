/**
 * Levenshtein distance — iterative, O(m*n) time, O(min(m,n)) space.
 * Used by the fuzzy FTS5 fallback in routes/spa-api/search.js.
 */
function levenshtein(a, b) {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  // Keep only two rows to save memory.
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array(lb + 1);
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/**
 * Score a document row against a query string.
 * Lower score = closer match. Uses the minimum Levenshtein distance
 * across (original_name, customer_name, customer_cid, doc_number)
 * against any query token.
 *
 * @param {object} doc - document row from SQLite
 * @param {string[]} tokens - lower-cased query tokens
 * @returns {number} minimum distance found
 */
function scoreDoc(doc, tokens) {
  const fields = [
    doc.original_name,
    doc.customer_name,
    doc.customer_cid,
    doc.doc_number,
  ]
    .filter(Boolean)
    .map((f) => String(f).toLowerCase());

  let best = Infinity;
  for (const token of tokens) {
    for (const field of fields) {
      // Also try substring windows the same length as the token.
      const win = token.length;
      for (let s = 0; s <= field.length - win; s++) {
        const d = levenshtein(token, field.slice(s, s + win));
        if (d < best) best = d;
      }
      // Full-field distance as a fallback.
      const d = levenshtein(token, field);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? 9999 : best;
}

module.exports = { levenshtein, scoreDoc };
