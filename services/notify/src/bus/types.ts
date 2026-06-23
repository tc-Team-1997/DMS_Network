export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  ts?: string;
}

export interface EventBus {
  publish(e: DomainEvent): Promise<void>;
  subscribe(type: string, handler: (e: DomainEvent) => void | Promise<void>): void;
}
