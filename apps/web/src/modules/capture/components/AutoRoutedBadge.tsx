/**
 * AutoRoutedBadge — shown after upload when the backend auto-resolved the
 * folder from the document type's default_folder_id.
 *
 * compact=true → small inline badge (used inside BatchFileCard)
 * compact=false → full card with "Move…" link (used in single-file summary)
 */

import { Sparkles, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AutoRoutedBadgeProps {
  folderName: string;
  documentId: number;
  compact?: boolean;
}

export function AutoRoutedBadge({
  folderName,
  documentId,
  compact = false,
}: AutoRoutedBadgeProps) {
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-input border-l-2 border-brand-blue bg-gradient-to-r from-brand-skyLight/60 to-brand-blue/10 px-2 py-0.5 text-[10px] text-brand-blue"
        data-testid="capture-auto-routed-badge"
        title={`AI auto-routed to folder: ${folderName}`}
      >
        <Sparkles size={9} aria-hidden="true" />
        <FolderOpen size={9} aria-hidden="true" />
        {folderName}
      </span>
    );
  }

  return (
    <div
      className="rounded-lg border-l-4 border-brand-blue bg-gradient-to-r from-brand-skyLight/60 to-brand-blue/10 px-3 py-2 space-y-1"
      data-testid="capture-auto-routed-badge"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-brand-blue">
        <Sparkles size={12} aria-hidden="true" />
        AI auto-routed to
        <FolderOpen size={12} aria-hidden="true" />
        <span>{folderName}</span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink-sub">
          Reviewer can confirm or move during approval.
        </p>
        <Link
          to={`/viewer/${documentId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-blue hover:underline"
          aria-label={`Open document ${documentId} in viewer to change folder`}
        >
          <FolderOpen size={11} aria-hidden="true" /> Move…
        </Link>
      </div>
    </div>
  );
}
