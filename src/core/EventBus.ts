type Handler<T> = (payload: T) => void;

/**
 * Bus typé minimal.
 *
 * Le curseur, le pointeur et l'ordonnanceur de comportements doivent pouvoir
 * solliciter la machine à états sans se connaître les uns les autres.
 */
export class EventBus<Events extends Record<string, unknown>> {
  readonly #handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of set) (handler as Handler<Events[K]>)(payload);
  }
}
