/**
 * tokenDiff — pure name-token diff for AML hit-decide v2.
 *
 * No external dep. Splits both strings on whitespace, normalises to lowercase,
 * then classifies each token from each side as:
 *   'match'   — exact match found in the other side
 *   'partial' — substring overlap (one token contains the other)
 *   'miss'    — no relationship to any token in the other side
 *
 * Returns two parallel arrays (one per string) so the UI can colour-code tokens
 * without knowing about the matching internals.
 */

export type TokenClass = 'match' | 'partial' | 'miss';

export interface DiffToken {
  text: string;
  kind: TokenClass;
}

export interface TokenDiffResult {
  /** Tokens from string A with their classification relative to B. */
  a: DiffToken[];
  /** Tokens from string B with their classification relative to A. */
  b: DiffToken[];
}

/** Normalise a name string for comparison: lowercase, collapse whitespace. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split into tokens (normalised). */
function tokenise(s: string): string[] {
  return normalise(s).split(' ').filter((t) => t.length > 0);
}

function classify(token: string, others: readonly string[]): TokenClass {
  if (others.includes(token)) return 'match';
  for (const o of others) {
    if (token.length >= 2 && o.length >= 2) {
      if (token.includes(o) || o.includes(token)) return 'partial';
    }
  }
  return 'miss';
}

/**
 * Compute the token-level diff between two name strings.
 *
 * @param a - subject name (customer record)
 * @param b - watchlist entry name
 */
export function tokenDiff(a: string, b: string): TokenDiffResult {
  const tokensA = tokenise(a || '');
  const tokensB = tokenise(b || '');

  return {
    a: tokensA.map((t) => ({ text: t, kind: classify(t, tokensB) })),
    b: tokensB.map((t) => ({ text: t, kind: classify(t, tokensA) })),
  };
}
