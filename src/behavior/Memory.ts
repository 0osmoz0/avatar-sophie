/**
 * Mémoire courte : anti-répétition, cooldowns, novelty, tendances temporaires.
 * Pas de stockage permanent, pas de contenu utilisateur.
 *
 * Phase 6 — tendances personnalité latentes (soft only, jamais de Goal forcé).
 */

export interface MemoryEvent {
  label: string;
  at: number;
}

export interface MemoryEntryView {
  label: string;
  ageSec: number;
}

export interface PersonalitySnapshot {
  playful: number;
  social: number;
  curiosity: number;
  calm: number;
  independence: number;
}

const MAX_HISTORY = 12;
const MAX_AGE_MS = 120_000;
/** Décroissance tendances courtes (~demi-vie ~25 s). */
const TENDENCY_DECAY_PER_SEC = 0.028;
/** Décroissance lente des traits personnalité vers la baseline. */
const PERSONALITY_DECAY_PER_SEC = 0.012;
const PERSONALITY_BASELINE = 0.5;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function lerpToward(value: number, target: number, t: number): number {
  return value + (target - value) * t;
}

export class Memory {
  readonly #events: MemoryEvent[] = [];
  readonly #cooldowns = new Map<string, number>();

  /** Tendances temporaires bornées [0,1] — n'imposent jamais une anim. */
  recentPositiveInteraction = 0;
  recentFrustration = 0;
  recentActivity = 0;

  /**
   * Tendances personnalité émergentes [0,1].
   * Neutre ≈ 0.5 ; décroissent vers la baseline ; jamais permanentes.
   */
  playfulness = PERSONALITY_BASELINE;
  sociability = PERSONALITY_BASELINE;
  curiosityBias = PERSONALITY_BASELINE;
  calmness = PERSONALITY_BASELINE;
  independence = PERSONALITY_BASELINE;

  /** Labels récents (fenêtre courte) — lecture debug / novelty. */
  get recentBehaviorLabels(): readonly string[] {
    return this.#events.map((e) => e.label);
  }

  remember(actionId: string, now: number, cooldownMs = 0): void {
    this.#events.push({ label: actionId, at: now });
    this.#prune(now);
    if (cooldownMs > 0) this.#cooldowns.set(actionId, now + cooldownMs);
    this.#nudgeFromLabel(actionId);
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
   * Novelty soft — jamais assez fort pour mettre une utilité à 0.
   * idle/walk/look : poids ~0.50, plancher ≈ 0.65 (cible 0.65–0.85 si récent).
   * Émotions : poids un peu plus fort (anti-spam soft).
   * Autres : poids ~0.28 (léger), plancher ≈ 0.75.
   */
  noveltyModifier(actionId: string): number {
    const pen = this.recencyPenalty(actionId);
    const emotion =
      actionId === "happy" ||
      actionId === "excited" ||
      actionId === "blow_kiss" ||
      actionId === "angry" ||
      actionId === "crying";
    const strong =
      actionId === "walk" || actionId === "look" || actionId === "idle";
    const weight = emotion ? 0.42 : strong ? 0.5 : 0.28;
    const floor = emotion ? 0.62 : strong ? 0.65 : 0.75;
    const raw = 1 - pen * weight;
    return Math.max(floor, raw);
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

  /** Alias debug / chaînes — dernier comportement mémorisé. */
  lastBehavior(): string | null {
    return this.last();
  }

  /**
   * Derniers n labels, du plus ancien au plus récent.
   * Ex. recentChain(2) → ["walk","look"] puis évaluation de walk = oscillation.
   */
  recentChain(n: number): string[] {
    if (n <= 0) return [];
    return this.#events.slice(-n).map((e) => e.label);
  }

  recentlyDid(actionId: string, within = 3): boolean {
    return this.#events.slice(-within).some((e) => e.label === actionId);
  }

  notePositive(amount = 0.35): void {
    this.recentPositiveInteraction = clamp01(this.recentPositiveInteraction + amount);
    this.nudgePersonality({
      playfulness: amount * 0.12,
      sociability: amount * 0.14,
    });
  }

  noteFrustration(amount = 0.35): void {
    this.recentFrustration = clamp01(this.recentFrustration + amount);
    this.nudgePersonality({
      calmness: -amount * 0.18,
      playfulness: -amount * 0.06,
    });
  }

  noteActivity(amount = 0.25): void {
    this.recentActivity = clamp01(this.recentActivity + amount);
  }

  /** Ajuste les tendances personnalité — petits deltas, clamp [0,1]. */
  nudgePersonality(
    partial: Partial<{
      playfulness: number;
      sociability: number;
      curiosityBias: number;
      calmness: number;
      independence: number;
      playful: number;
      social: number;
      curiosity: number;
      calm: number;
    }>,
  ): void {
    if (partial.playfulness != null || partial.playful != null) {
      this.playfulness = clamp01(
        this.playfulness + (partial.playfulness ?? partial.playful ?? 0),
      );
    }
    if (partial.sociability != null || partial.social != null) {
      this.sociability = clamp01(
        this.sociability + (partial.sociability ?? partial.social ?? 0),
      );
    }
    if (partial.curiosityBias != null || partial.curiosity != null) {
      this.curiosityBias = clamp01(
        this.curiosityBias + (partial.curiosityBias ?? partial.curiosity ?? 0),
      );
    }
    if (partial.calmness != null || partial.calm != null) {
      this.calmness = clamp01(this.calmness + (partial.calmness ?? partial.calm ?? 0));
    }
    if (partial.independence != null) {
      this.independence = clamp01(this.independence + partial.independence);
    }
  }

  personalitySnapshot(): PersonalitySnapshot {
    return {
      playful: this.playfulness,
      social: this.sociability,
      curiosity: this.curiosityBias,
      calm: this.calmness,
      independence: this.independence,
    };
  }

  /**
   * Facteur soft [0.90, 1.15] selon tendances — jamais 0.
   * Utilisé par activityModifiers ; Needs/cooldown restent prioritaires.
   */
  personalityFactor(considerationId: string): number {
    const p = this.playfulness;
    const s = this.sociability;
    const c = this.curiosityBias;
    const calm = this.calmness;
    const ind = this.independence;

    let f = 1;
    const high = (v: number) => Math.max(0, v - 0.5);
    const low = (v: number) => Math.max(0, 0.5 - v);

    if (considerationId === "dance" || considerationId === "excited") {
      f *= 1 + high(p) * 0.28;
      f *= 1 - high(calm) * 0.12;
    }
    if (
      considerationId === "happy" ||
      considerationId === "blow_kiss" ||
      considerationId === "look"
    ) {
      f *= 1 + high(s) * 0.24;
    }
    if (
      considerationId === "look" ||
      considerationId === "window" ||
      considerationId === "perch" ||
      considerationId === "walk"
    ) {
      f *= 1 + high(c) * 0.22;
    }
    if (
      considerationId === "work" ||
      considerationId === "study" ||
      considerationId === "think" ||
      considerationId === "walk"
    ) {
      f *= 1 + high(ind) * 0.2;
    }
    if (considerationId === "cursor") {
      f *= 1 - high(ind) * 0.22;
    }
    if (
      considerationId === "idle" ||
      considerationId === "think" ||
      considerationId === "perch"
    ) {
      f *= 1 + high(calm) * 0.18;
    }
    // Soft damp if trait is low for social/play picks
    if (considerationId === "dance" && low(p) > 0.15) f *= 1 - low(p) * 0.1;

    return Math.min(1.15, Math.max(0.9, f));
  }

  /** Hint debug : trait dominant qui pousse ce pick. */
  personalityHint(considerationId: string): string | null {
    const f = this.personalityFactor(considerationId);
    if (f < 1.04) return null;
    const snap = this.personalitySnapshot();
    const ranked = Object.entries(snap).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    if (!top || top[1] < 0.55) return null;
    return `${top[0]}↑`;
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

    // Traits → baseline (réversible, jamais collés à un extrême).
    const pDecay = Math.min(1, PERSONALITY_DECAY_PER_SEC * dt);
    this.playfulness = clamp01(
      lerpToward(this.playfulness, PERSONALITY_BASELINE, pDecay),
    );
    this.sociability = clamp01(
      lerpToward(this.sociability, PERSONALITY_BASELINE, pDecay),
    );
    this.curiosityBias = clamp01(
      lerpToward(this.curiosityBias, PERSONALITY_BASELINE, pDecay),
    );
    this.calmness = clamp01(lerpToward(this.calmness, PERSONALITY_BASELINE, pDecay));
    this.independence = clamp01(
      lerpToward(this.independence, PERSONALITY_BASELINE, pDecay),
    );
  }

  #nudgeFromLabel(label: string): void {
    switch (label) {
      case "pet":
      case "love":
      case "happy":
        this.nudgePersonality({ playfulness: 0.05, sociability: 0.06 });
        break;
      case "wave":
        this.nudgePersonality({ sociability: 0.05 });
        break;
      case "blow_kiss":
        this.nudgePersonality({ sociability: 0.07, playfulness: 0.03 });
        break;
      case "poke":
      case "interrupted":
      case "angry":
        this.nudgePersonality({ calmness: -0.07, playfulness: -0.03 });
        break;
      case "user_returned":
        this.nudgePersonality({ sociability: 0.06 });
        break;
      case "user_became_idle":
        this.nudgePersonality({ curiosityBias: 0.05, independence: 0.03 });
        break;
      case "user_became_busy":
        this.nudgePersonality({ independence: 0.06, sociability: -0.03 });
        break;
      case "look":
      case "window":
      case "perch":
        this.nudgePersonality({ curiosityBias: 0.04 });
        break;
      case "work":
      case "study":
      case "think":
        this.nudgePersonality({ independence: 0.04, calmness: 0.02 });
        break;
      case "dance":
      case "excited":
        this.nudgePersonality({ playfulness: 0.05 });
        break;
      default:
        break;
    }
  }

  #prune(now: number): void {
    while (this.#events.length > MAX_HISTORY) this.#events.shift();
    while (this.#events.length > 0 && now - this.#events[0]!.at > MAX_AGE_MS) {
      this.#events.shift();
    }
  }
}
