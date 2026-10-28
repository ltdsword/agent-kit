import type { StreamEvent } from "@agent-hub/protocol";

export class EventHub {
  private readonly listeners = new Set<(event: StreamEvent) => void>();

  publish(event: StreamEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: StreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
