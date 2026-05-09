/**
 * VersionsPanel — right-rail "Versions" tab.
 *
 * Lists document version history. pdf-lib cannot diff PDF pages —
 * it is a creation/edit library, not a text-diff engine. Full side-by-side
 * PDF diff requires pdfjs-dist + custom text-layer diffing, which is beyond
 * the scope of this module (Wave C). Deviation documented in final report.
 *
 * Fallback: "Open both versions" links are provided when two versions are
 * selected, satisfying the brief's documented fallback.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchVersions, type DocVersion } from '../api';

// ── props ─────────────────────────────────────────────────────────────────────

export interface VersionsPanelProps {
  documentId: number;
  currentFilename: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export function VersionsPanel({ documentId, currentFilename }: VersionsPanelProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: versions, isLoading, isError } = useQuery({
    queryKey: ['versions', documentId],
    queryFn: () => fetchVersions(documentId),
    staleTime: 60_000,
  });

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 2) {
          // Replace the older selection — keep the most recently chosen
          const [first] = next;
          if (first !== undefined) next.delete(first);
        }
        next.add(id);
      }
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded-input bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="p-4 text-xs text-danger">Failed to load versions.</p>;
  }

  const versionList = versions ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Compare banner */}
      {selected.size === 2 && (
        <CompareBanner
          selected={selected}
          versions={versionList}
          currentFilename={currentFilename}
        />
      )}

      {selected.size === 1 && (
        <div className="px-4 py-2 bg-brand-skyLight text-xs text-brand-blue border-b border-divider">
          Select one more version to compare.
        </div>
      )}

      {versionList.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted text-center px-4">
            No version history recorded for this document.
          </p>
        </div>
      ) : (
        <ul
          className="flex-1 overflow-y-auto divide-y divide-divider"
          data-testid="versions-list"
        >
          {versionList.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              isSelected={selected.has(v.id)}
              onToggle={toggleSelect}
            />
          ))}
        </ul>
      )}

      <p className="px-4 py-2 text-2xs text-muted border-t border-divider">
        Full side-by-side diff requires Wave C DocBrain v2.
      </p>
    </div>
  );
}

// ── VersionRow ────────────────────────────────────────────────────────────────

function VersionRow({
  version,
  isSelected,
  onToggle,
}: {
  version: DocVersion;
  isSelected: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3 hover:bg-divider cursor-pointer',
        isSelected && 'bg-brand-skyLight',
      )}
      onClick={() => onToggle(version.id)}
      data-testid={`version-row-${version.id}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(version.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select version ${version.version}`}
        className="mt-0.5 h-3 w-3 rounded accent-brand-blue flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink">
            <FileText size={11} className="inline mr-1 text-muted" />
            {version.version}
          </span>
          <a
            href={`/uploads/${version.filename}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open version ${version.version} in new tab`}
            className="text-brand-blue hover:text-brand-blueHover flex-shrink-0"
          >
            <ExternalLink size={11} />
          </a>
        </div>
        <p className="text-2xs text-muted mt-0.5">
          {new Date(version.created_at).toLocaleString()}
          {version.change_note && ` · ${version.change_note}`}
        </p>
      </div>
    </li>
  );
}

// ── CompareBanner ─────────────────────────────────────────────────────────────

function CompareBanner({
  selected,
  versions,
  currentFilename: _currentFilename,
}: {
  selected: Set<number>;
  versions: DocVersion[];
  currentFilename: string;
}) {
  const [idA, idB] = [...selected];
  const vA = idA !== undefined ? versions.find((v) => v.id === idA) : undefined;
  const vB = idB !== undefined ? versions.find((v) => v.id === idB) : undefined;

  if (!vA || !vB) return null;

  return (
    <div
      className="px-4 py-3 bg-brand-skyLight border-b border-divider text-xs text-brand-blue space-y-1.5"
      data-testid="version-compare-banner"
    >
      <p className="font-medium">Comparing {vA.version} vs {vB.version}</p>
      <div className="flex gap-3">
        <a
          href={`/uploads/${vA.filename}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline hover:no-underline"
        >
          Open {vA.version} <ExternalLink size={10} />
        </a>
        <a
          href={`/uploads/${vB.filename}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline hover:no-underline"
        >
          Open {vB.version} <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
