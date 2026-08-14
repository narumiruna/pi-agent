export type WebEventType =
  | "interaction"
  | "message_delta"
  | "notification"
  | "package_progress"
  | "provider_auth"
  | "run_status"
  | "tool_status";

export interface WebEvent<T = unknown> {
  id: number;
  type: WebEventType;
  data: T;
}

export type EventListener = (event: WebEvent) => void;

export class EventHub {
  private readonly events: WebEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private nextId = 1;

  constructor(private readonly capacity = 500) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("Event capacity must be positive");
  }

  get cursor(): number {
    return this.nextId - 1;
  }

  publish<T>(type: WebEventType, data: T): WebEvent<T> {
    const event: WebEvent<T> = { id: this.nextId++, type, data };
    this.events.push(event);
    if (this.events.length > this.capacity)
      this.events.splice(0, this.events.length - this.capacity);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  replayAfter(id: number): WebEvent[] | undefined {
    if (!Number.isSafeInteger(id) || id < 0) return undefined;
    const first = this.events[0];
    if (first && id < first.id - 1) return undefined;
    return this.events.filter((event) => event.id > id);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
