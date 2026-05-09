/**
 * Typed pub/sub event bus for cross-module communication.
 *
 * Usage:
 *   const unsub = eventBus.on('viewer:scroll-to-span', (payload) => { ... });
 *   eventBus.emit({ type: 'viewer:scroll-to-span', payload: { ... } });
 *   unsub(); // clean up
 */

export type AppEvent =
  | {
      type: 'viewer:scroll-to-span';
      payload: {
        documentId: string;
        span: { page: number; x?: number; y?: number; w?: number; h?: number };
      };
    }
  | {
      type: 'tenant:switched';
      payload: { tenantId: string };
    }
  | {
      type: 'config:updated';
      payload: { namespace: string; key: string };
    };

type EventType = AppEvent['type'];
type PayloadOf<T extends EventType> = Extract<AppEvent, { type: T }>['payload'];
type Handler<T extends EventType> = (payload: PayloadOf<T>) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerMap = Map<string, Set<Handler<any>>>;

function createEventBus() {
  const listeners: HandlerMap = new Map();

  function on<T extends EventType>(type: T, handler: Handler<T>): () => void {
    let set = listeners.get(type);
    if (set === undefined) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler);
    return () => {
      listeners.get(type)?.delete(handler);
    };
  }

  function emit<T extends EventType>(event: Extract<AppEvent, { type: T }>): void {
    const set = listeners.get(event.type);
    if (set === undefined) return;
    for (const handler of set) {
      handler(event.payload);
    }
  }

  return { on, emit } as const;
}

export const eventBus = createEventBus();
