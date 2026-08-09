/**
 * Mémoire courte : anti-répétition, cooldowns, novelty, tendances temporaires.
 * Pas de stockage permanent, pas de contenu utilisateur.
 */

export interface MemoryEvent {
  label: string;
  at: number;
}

export interface MemoryEntryView {
  label: string;
  ageSec: number;
}

const MAX_HISTORY = 12;
const MAX_AGE_MS = 120_000;
/** Décroissance tendances (~demi-vie ~25 s). */
const TENDENCY_DECAY_PER_SEC = 0.028;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class Memory {
  readonly #events: MemoryEvent[] = [];
  readonly #cooldowns = new Map<string, number>();

  /** Tendances temporaires bornées [0,1] — n'imposent jamais une anim. */
  recentPositiveInteraction = 0;
  recentFrustration = 0;
  recentActivity = 0;

  /** Labels récents (fenêtre courte) — lecture debug / novelty. */
  get recentBehaviorLabels(): readonly string[] {
    return this.#events.map((e) => e.label);
  }

  remember(actionId: string, now: number, cooldownMs = 0): void {
    this.#events.push({ label: actionId, at: now });
    this.#prune(now);
    if (cooldownMs > 0) this.#cooldowns.set(actionId, now + cooldownMs);
  }

  ready(actionId: string, now: number): boolean {
    return (this.#cooldowns.get(actionId) ?? 0) <= now;
  }

  /** Âge en secondes du dernier événement avec ce label, ou null. */
  ageSec(label: string, now: number): number | null {
    for (let i = this.#events.length - 1; i >= 0; i--) {
      const e = this.#events[i]!;
      if (e.label === label) return (now - e.at) / 1000;
    }
    return null;
  }

  /** Vrai si un label est apparu dans les `maxAgeMs` dernières ms. */
  recentWithin(label: string, now: number, maxAgeMs: number): boolean {
    const age = this.ageSec(label, now);
    return age != null && age * 1000 <= maxAgeMs;
  }

  /** Entrées récentes pour debug (plus récentes d'abord). */
  recentEntries(now: number, limit = 6): MemoryEntryView[] {
    this.#prune(now);
    const out: MemoryEntryView[] = [];
    for (let i = this.#events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.#events[i]!;
      out.push({ label: e.label, ageSec: (now - e.at) / 1000 });
    }
    return out;
  }

  /** Pénalité 0..1 : 1 = vient d'être fait (par position dans l'historique). */
  recencyPenalty(actionId: string): number {
    const index = this.#events.map((e) => e.label).lastIndexOf(actionId);
    if (index < 0) return 0;
    const age = this.#events.length - 1 - index;
    return Math.max(0, 1 - age / MAX_HISTORY);
  }

  /**
   * Novelty soft 0.75..1 — jamais assez fort pour battre un vrai besoin
   * (ex. sleep 1.8 × 0.75 reste > dance 0.7).
   */
  noveltyModifier(actionId: string): number {
    const pen = this.recencyPenalty(actionId);
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
    return this.#events[this.#events.length - 1]?.label ?? null;
  }

  recentlyDid(actionId: string, within = 3): boolean {
    return this.#events
      .slice(-within)
      .some((e) => e.label === actionId);
  }

  notePositive(amount = 0.35): void {
    this.recentPositiveInteraction = clamp01(this.recentPositiveInteraction + amount);
  }

  noteFrustration(amount = 0.35): void {
    this.recentFrustration = clamp01(this.recentFrustration + amount);
  }

  noteActivity(amount = 0.25): void {
    this.recentActivity = clamp01(this.recentActivity + amount);
  }

  /** Décroissance progressive des tendances. */
  update(dt: number): void {
    const decay = Math.max(0, 1 - TENDENCY_DECAY_PER_SEC * dt);
    this.recentPositiveInteraction *= decay;
    this.recentFrustration *= decay;
    this.recentActivity *= decay;
    if (this.recentPositiveInteraction < 0.01) this.recentPositiveInteraction = 0;
    if (this.recentFrustration < 0.01) this.recentFrustration = 0;
    if (this.recentActivity < 0.01) this.recentActivity = 0;
  }

  #prune(now: number): void {
    while (this.#events.length > MAX_HISTORY) this.#events.shift();
    while (this.#events.length > 0 && now - this.#events[0]!.at > MAX_AGE_MS) {
      this.#events.shift();
    }
  }
}
