/**
 * OfflineIndicator — sticky pill in the top bar showing offline status
 * and outbox queue count.
 *
 * Hidden when online AND outbox is empty.
 * Shows "Offline (N queued)" when offline OR queue has entries.
 * Click triggers a manual sync via the Service Worker.
 *
 * Test IDs:
 *   offline-indicator              — outer wrapper (only rendered when visible)
 *   offline-indicator-count        — the count badge span
 *   offline-indicator-trigger-sync — the trigger sync button
 */

import { useCallback, useEffect, useSyncExternalStore, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { count as outboxCount } from '@/lib/offline-outbox';
import { triggerSync } from '@/lib/sw-register';

// ── Online status store ──────────────────────────────────────────────────────

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getOnlineServerSnapshot(): boolean {
  // SSR guard — assume online on server.
  return true;
}

// ── Sync message listener ────────────────────────────────────────────────────

type SyncCompleteMessage = {
  type: 'SYNC_COMPLETE';
  success: number;
  deduped: number;
  failed: number;
};

function isSyncComplete(data: unknown): data is SyncCompleteMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)['type'] === 'SYNC_COMPLETE'
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function OfflineIndicator() {
  const isOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );

  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Poll the outbox count periodically and on network status change.
  const refreshCount = useCallback(() => {
    outboxCount()
      .then(setQueueCount)
      .catch(() => { /* IDB may be unavailable */ });
  }, []);

  useEffect(() => {
    refreshCount();
    // Poll every 10 seconds.
    const id = setInterval(refreshCount, 10_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Re-check after coming back online.
  useEffect(() => {
    if (isOnline) refreshCount();
  }, [isOnline, refreshCount]);

  // Listen for SYNC_COMPLETE messages from the Service Worker.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (isSyncComplete(event.data)) {
        setSyncing(false);
        refreshCount();
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [refreshCount]);

  // Hide entirely when online and nothing queued.
  const visible = !isOnline || queueCount > 0;
  if (!visible) return null;

  const handleTriggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerSync();
    } catch {
      setSyncing(false);
    }
    // Reset syncing state after timeout (SW postMessage does not ACK for fallback).
    setTimeout(() => { setSyncing(false); refreshCount(); }, 5_000);
  };

  const label = isOnline
    ? `${queueCount} pending upload${queueCount !== 1 ? 's' : ''} — tap to sync`
    : `Offline${queueCount > 0 ? ` (${queueCount} queued)` : ''}`;

  return (
    <div
      data-testid="offline-indicator"
      role="status"
      aria-live="polite"
      aria-label={
        isOnline
          ? `${queueCount} pending upload${queueCount !== 1 ? 's' : ''}, ready to sync`
          : `Offline queue has ${queueCount} pending upload${queueCount !== 1 ? 's' : ''}`
      }
      className={cn(
        'flex items-center gap-1.5 rounded-badge border px-3 py-1 text-xs font-medium',
        'transition-opacity duration-200',
        isOnline
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-danger/40 bg-danger/10 text-danger',
      )}
    >
      <WifiOff size={12} aria-hidden="true" />
      <span>{label}</span>
      {queueCount > 0 && (
        <span
          data-testid="offline-indicator-count"
          className={cn(
            'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-2xs font-semibold min-w-[18px]',
            isOnline ? 'bg-warning text-white' : 'bg-danger text-white',
          )}
          aria-hidden="true"
        >
          {queueCount}
        </span>
      )}
      <button
        data-testid="offline-indicator-trigger-sync"
        type="button"
        onClick={() => { void handleTriggerSync(); }}
        disabled={syncing || !isOnline}
        aria-label="Trigger sync now"
        className={cn(
          'ml-1 rounded-full p-0.5 transition-colors',
          'hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <RefreshCw
          size={11}
          aria-hidden="true"
          className={syncing ? 'animate-spin' : ''}
        />
      </button>
    </div>
  );
}
