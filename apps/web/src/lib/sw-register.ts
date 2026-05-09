/**
 * sw-register.ts — Service Worker registration for offline sync (BHU-57).
 *
 * Registers /sw.js when:
 *  - `'serviceWorker' in navigator` (browser support check)
 *  - FF_OFFLINE_SYNC env flag is truthy
 *
 * Listens for `controllerchange` to log SW updates (e.g. a new version
 * of sw.js has been activated and taken control).
 */

const FF_OFFLINE_SYNC: boolean =
  import.meta.env['VITE_FF_OFFLINE_SYNC'] !== undefined
    ? import.meta.env['VITE_FF_OFFLINE_SYNC'] !== 'false' &&
      import.meta.env['VITE_FF_OFFLINE_SYNC'] !== '0' &&
      import.meta.env['VITE_FF_OFFLINE_SYNC'] !== ''
    : false;

let _registered = false;

/**
 * Register the Service Worker. Safe to call multiple times — only
 * registers once per page load.
 *
 * Returns the registration object, or null if unavailable / flag off.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (_registered) return null;
  if (!FF_OFFLINE_SYNC) return null;
  if (!('serviceWorker' in navigator)) {
    console.warn('[sw-register] Service Worker not supported in this browser.');
    return null;
  }

  _registered = true;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    console.info('[sw-register] Service Worker registered:', registration.scope);

    // Log when a new SW version takes control (prompts user to refresh in prod).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.info('[sw-register] Service Worker updated — new controller active.');
    });

    return registration;
  } catch (err) {
    console.error('[sw-register] Service Worker registration failed:', err);
    return null;
  }
}

/**
 * Trigger a background sync event (calls the SW's sync handler for
 * the "offline-upload-queue" tag).
 *
 * Falls back to a direct postMessage if BackgroundSync is unavailable.
 */
export async function triggerSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const controller = navigator.serviceWorker.controller;
  if (!controller) return;

  // Attempt Background Sync API first.
  const registration = await navigator.serviceWorker.ready;
  if ('sync' in registration) {
    try {
      await (registration as ServiceWorkerRegistration & {
        sync: { register: (tag: string) => Promise<void> };
      }).sync.register('offline-upload-queue');
      return;
    } catch {
      // Background Sync not available — fall through to postMessage.
    }
  }

  // Fallback: direct postMessage to SW.
  controller.postMessage({ type: 'TRIGGER_SYNC' });
}
