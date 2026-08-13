import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type { EventHub } from "../agent/events.js";

export type InteractionKind =
  | "confirm"
  | "editor"
  | "input"
  | "secret"
  | "select"
  | "text";

interface PendingInteraction {
  data: Record<string, unknown> & { id: string; kind: InteractionKind };
  resolve: (value: string | undefined) => void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
}

export class InteractionBroker {
  private readonly pending = new Map<string, PendingInteraction>();

  constructor(private readonly events: EventHub) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  replayPending(publish: (data: Record<string, unknown>) => void): number {
    for (const interaction of this.pending.values()) publish(interaction.data);
    return this.pending.size;
  }

  request(
    kind: InteractionKind,
    payload: Record<string, unknown>,
    options: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<string | undefined> {
    const id = crypto.randomUUID();
    const data = { id, kind, ...payload, timeout: options.timeout };
    let published = false;
    const promise = new Promise<string | undefined>((resolve) => {
      const entry: PendingInteraction = { data, resolve };
      const finish = () => {
        const current = this.pending.get(id);
        if (!current) return;
        this.pending.delete(id);
        if (current.timer) clearTimeout(current.timer);
        current.removeAbort?.();
        if (published)
          this.events.publish("interaction", { id, kind: "dismiss" });
        resolve(undefined);
      };
      this.pending.set(id, entry);
      if (options.timeout && options.timeout > 0)
        entry.timer = setTimeout(finish, options.timeout);
      if (options.signal) {
        if (options.signal.aborted) {
          finish();
        } else {
          const onAbort = () => finish();
          options.signal.addEventListener("abort", onAbort, { once: true });
          entry.removeAbort = () =>
            options.signal?.removeEventListener("abort", onAbort);
        }
      }
    });
    if (this.pending.has(id)) {
      this.events.publish("interaction", data);
      published = true;
    }
    return promise;
  }

  respond(id: string, value?: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    pending.removeAbort?.();
    this.events.publish("interaction", { id, kind: "dismiss" });
    pending.resolve(value);
    return true;
  }

  async prompt(prompt: AuthPrompt): Promise<string> {
    const kind: InteractionKind =
      prompt.type === "manual_code" ? "text" : prompt.type;
    const value = await this.request(
      kind,
      {
        title: prompt.message,
        ...(prompt.type === "select" ? { options: prompt.options } : {}),
        ...(prompt.type !== "select" && prompt.placeholder
          ? { placeholder: prompt.placeholder }
          : {}),
      },
      prompt.signal ? { signal: prompt.signal } : {},
    );
    if (value === undefined)
      throw new DOMException(
        "Authentication interaction was cancelled",
        "AbortError",
      );
    return value;
  }

  notify(event: AuthEvent): void {
    this.events.publish("notification", event);
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.respond(id);
  }
}
