/**
 * Mémoire courte : anti-répétition et cooldowns d'actions.
 */

export class Memory {
  readonly #lastActions: string[] = [];
  readonly #cooldowns = new Map<string, number>();
  #maxHistory = 8;

  remember(actionId: string, now: number, cooldownMs = 0): void {
    this.#lastActions.push(actionId);
    if (this.#lastActions.length > this.#maxHistory) this.#lastActions.shift();
    if (cooldownMs > 0) this.#cooldowns.set(actionId, now + cooldownMs);
  }

  ready(actionId: string, now: number): boolean {
    return (this.#cooldowns.get(actionId) ?? 0) <= now;
  }

  /** Pénalité 0..1 : 1 = vient d'être fait. */
  recencyPenalty(actionId: string): number {
    const index = this.#lastActions.lastIndexOf(actionId);
    if (index < 0) return 0;
    const age = this.#lastActions.length - 1 - index;
    return Math.max(0, 1 - age / this.#maxHistory);
  }

  last(): string | null {
    return this.#lastActions[this.#lastActions.length - 1] ?? null;
  }

  recentlyDid(actionId: string, within = 3): boolean {
    return this.#lastActions.slice(-within).includes(actionId);
  }
}
