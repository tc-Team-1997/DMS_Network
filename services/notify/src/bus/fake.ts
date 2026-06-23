import type { DomainEvent, EventBus } from "./types.js";

export class InMemoryBus implements EventBus {
  private readonly handlers = new Map<string, Array<(e: DomainEvent) => void | Promise<void>>>();

  subscribe(type: string, handler: (e: DomainEvent) => void | Promise<void>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish(e: DomainEvent): Promise<void> {
    const event: DomainEvent = { ...e, ts: e.ts ?? new Date().toISOString() };
    const list = this.handlers.get(e.type) ?? [];
    for (const h of list) await h(event);
  }
}
