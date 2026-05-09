/**
 * RedactedBadge — small pill shown on Repository rows where a document has
 * been redacted (`documents.redacted = 1`).
 *
 * - "Redacted" badge always visible.
 * - "View original" link visible only when the current user has the
 *   `view_unredacted` permission (Doc Admin or Auditor role).
 */

import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui';

// Roles that carry `view_unredacted` per contract §8
const UNREDACTED_ROLES = new Set(['Doc Admin', 'Auditor']);

export interface RedactedBadgeProps {
  /** The id of the redacted document (used to build the test id) */
  documentId: number;
  /** The id of the original (parent) document; null for originals with redacted children */
  parentId: number | null;
  /** Whether this document row is itself the redacted version */
  isRedactedVersion: boolean;
  /** Current user's role */
  userRole: string | null | undefined;
}

export function RedactedBadge({
  documentId,
  parentId,
  isRedactedVersion,
  userRole,
}: RedactedBadgeProps) {
  const canViewOriginal = Boolean(userRole && UNREDACTED_ROLES.has(userRole));

  return (
    <span
      data-testid={`redacted-badge-${documentId}`}
      className="inline-flex items-center gap-1"
    >
      <Badge tone="danger" className="inline-flex items-center gap-1">
        <ShieldOff size={10} />
        Redacted
      </Badge>

      {/* Show "View original" link only for redacted versions, not for
          originals that have redacted children.  Also gated by perm. */}
      {isRedactedVersion && parentId !== null && canViewOriginal && (
        <Link
          to={`/viewer/${parentId}`}
          className="text-2xs text-brand-blue hover:underline ml-1"
          aria-label="View original unredacted document"
        >
          View original
        </Link>
      )}
    </span>
  );
}
