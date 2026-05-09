/**
 * CustomizeDrawer — lets a user show/hide individual KPI tiles.
 *
 * Persistence: localStorage keyed by `dashboard_prefs_{userId}`.
 * Admin tile-catalog (which tiles exist at all) comes from tenant_config;
 * users can only hide tiles the admin has enabled, not re-enable removed ones.
 *
 * Deferred upgrade: the user_dashboards DB table (BRD #26, already in schema)
 * can back this in Wave B without any further migration — the layout_json
 * column is wide enough to hold this map.
 */

import { Drawer } from '@/components/ui';
import { TILE_IDS, TILE_LABELS, type TileId } from '../schemas';

interface CustomizeDrawerProps {
  open:           boolean;
  onClose:        () => void;
  /** Tiles available in the tenant catalog (from tenant_config). */
  catalog:        TileId[];
  /** Currently visible tile ids. */
  visible:        TileId[];
  onVisibleChange: (next: TileId[]) => void;
}

export function CustomizeDrawer({
  open,
  onClose,
  catalog,
  visible,
  onVisibleChange,
}: CustomizeDrawerProps) {
  function toggle(id: TileId) {
    const next = visible.includes(id)
      ? visible.filter((v) => v !== id)
      : [...visible, id];
    // Always keep at least 1 tile visible
    if (next.length === 0) return;
    onVisibleChange(next);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Customize tiles"
      width="360px"
    >
      <p className="text-sm text-muted mb-4">
        Choose which KPI tiles appear on your dashboard. Your selection is saved
        locally in this browser.
      </p>

      <ul className="flex flex-col gap-2">
        {TILE_IDS.filter((id) => catalog.includes(id)).map((id) => {
          const checked = visible.includes(id);
          return (
            <li
              key={id}
              className="flex items-center justify-between rounded-input border border-divider px-4 py-3"
            >
              <span className="text-sm font-medium text-ink">
                {TILE_LABELS[id]}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => toggle(id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                  checked ? 'bg-brand-blue' : 'bg-border'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                    checked ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted mt-5">
        Tiles removed from the tenant catalog by your administrator cannot be
        re-enabled here.
      </p>
    </Drawer>
  );
}
