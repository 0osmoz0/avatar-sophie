/**
 * Bus d'événements public Sophie — typé, découplé du Brain.
 * API: emit / subscribe / unsubscribe.
 */

import type {
  SophieEvent,
  SophieEventHandler,
  SophieEventType,
  SophieInboundEvent,
  SophieOutboundEvent,
} from "./types";

type Handler = SophieEventHandler<SophieEvent>;

export class SophieEventBus {
  readonly #handlers = new Map<SophieEventType | "*", Set<Handler>>();

  emit(event: SophieInboundEvent | SophieOutboundEvent): void {
    const payload: SophieEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      source: event.source ?? "external",
    };
    this.#dispatch(payload.type, payload);
    this.#dispatch("*", payload);
  }

  subscribe(
    event: SophieEventType | "*",
    callback: SophieEventHandler,
  ): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(callback);
    return () => this.unsubscribe(event, callback);
  }

  unsubscribe(event: SophieEventType | "*", callback: SophieEventHandler): void {
    this.#handlers.get(event)?.delete(callback);
  }

  /** Vide tous les handlers (tests). */
  clear(): void {
    this.#handlers.clear();
  }

  #dispatch(event: SophieEventType | "*", payload: SophieEvent): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of set) handler(payload);
  }
}
