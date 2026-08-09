/**
 * Mémoire courte : anti-répétition, cooldowns, novelty locale.
 */

export class Memory {
  readonly #lastActions: string[] = [];
  readonly #cooldowns = new Map<string, number>();
  #maxHistory = 8;

  /** Labels récents (fenêtre courte) — lecture debug / novelty. */
  get recentBehaviorLabels(): readonly string[] {
    return this.#lastActions;
  }

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

  /**
   * Novelty soft 0.75..1 — jamais assez fort pour battre un vrai besoin
   * (ex. sleep 1.8 × 0.75 reste > dance 0.7).
   */
  noveltyModifier(actionId: string): number {
    const pen = this.recencyPenalty(actionId);
    // Légèrement plus fort sur la boucle walk/look/idle (toujours ≥ 0.65).
    const weight = actionId === "walk" || actionId === "look" || actionId === "idle" ? 0.35 : 0.25;
    return 1 - pen * weight;
  }

  noveltyLabel(actionId: string): "high" | "ok" | "low" {
    const m = this.noveltyModifier(actionId);
    if (m >= 0.95) return "high";
    if (m >= 0.85) return "ok";
    return "low";
  }

  last(): string | null {
    return this.#lastActions[this.#lastActions.length - 1] ?? null;
  }

  recentlyDid(actionId: string, within = 3): boolean {
    return this.#lastActions.slice(-within).includes(actionId);
  }
}
