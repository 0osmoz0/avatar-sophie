/**
 * Jauges / drivers de personnalité.
 *
 * Évolution progressive ; `mood` est dérivé, pas une 6e jauge brute.
 */

export type NeedsDeltas = Partial<{
  energy: number;
  fatigue: number;
  boredom: number;
  affection: number;
  curiosity: number;
  social: number;
}>;

export class Needs {
  energy = 80;
  fatigue = 10;
  boredom = 20;
  affection = 50;
  curiosity = 55;
  social = 40;

  update(dt: number, active: string): void {
    if (active === "IDLE" || active === "LOOK_AROUND" || active === "THINK") {
      this.energy = clamp(this.energy + 1.2 * dt, 0, 100);
      this.boredom = clamp(this.boredom + 2.4 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 0.6 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity + 0.9 * dt, 0, 100);
    }

    if (active === "SLEEP") {
      this.energy = clamp(this.energy + 10 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 14 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 1.5 * dt, 0, 100);
    }

    if (active === "WORK" || active === "STUDY" || active === "OVERWORK") {
      this.energy = clamp(this.energy - 2.8 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue + 4.2 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 2.2 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity - 0.7 * dt, 0, 100);
    }

    if (active === "WALK" || active === "RUN") {
      this.boredom = clamp(this.boredom - 3.5 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity + 1.5 * dt, 0, 100);
      this.energy = clamp(this.energy - 1.1 * dt, 0, 100);
    }

    if (active === "DANCE" || active === "CURSOR_CHASE") {
      this.energy = clamp(this.energy - 3.5 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 7 * dt, 0, 100);
      this.social = clamp(this.social + 2.2 * dt, 0, 100);
    }

    if (active === "COFFEE") {
      this.energy = clamp(this.energy + 7 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 3.5 * dt, 0, 100);
    }

    if (active === "YAWN") {
      this.fatigue = clamp(this.fatigue + 0.4 * dt, 0, 100);
    }

    if (active === "HANG" || active === "PUSH" || active === "PULL") {
      this.curiosity = clamp(this.curiosity - 2.8 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 4.5 * dt, 0, 100);
    }

    if (active === "PET" || active === "HAPPY" || active === "LOVE" || active === "WAVE") {
      this.affection = clamp(this.affection + 9 * dt, 0, 100);
      this.social = clamp(this.social + 6 * dt, 0, 100);
    }

    // Dérive lente hors interaction sociale.
    this.social = clamp(this.social - 0.3 * dt, 0, 100);
  }

  /** Applique des deltas bornés (conséquences post-goal). */
  apply(deltas: NeedsDeltas): void {
    if (deltas.energy !== undefined) this.energy = clamp(this.energy + deltas.energy, 0, 100);
    if (deltas.fatigue !== undefined) this.fatigue = clamp(this.fatigue + deltas.fatigue, 0, 100);
    if (deltas.boredom !== undefined) this.boredom = clamp(this.boredom + deltas.boredom, 0, 100);
    if (deltas.affection !== undefined) {
      this.affection = clamp(this.affection + deltas.affection, 0, 100);
    }
    if (deltas.curiosity !== undefined) {
      this.curiosity = clamp(this.curiosity + deltas.curiosity, 0, 100);
    }
    if (deltas.social !== undefined) this.social = clamp(this.social + deltas.social, 0, 100);
  }

  snapshot(): Record<string, number | string> {
    return {
      e: Math.round(this.energy),
      f: Math.round(this.fatigue),
      b: Math.round(this.boredom),
      c: Math.round(this.curiosity),
      s: Math.round(this.social),
      a: Math.round(this.affection),
      mood: this.mood,
    };
  }

  get tired(): boolean {
    return this.fatigue >= 65 || this.energy <= 30;
  }

  get exhausted(): boolean {
    return this.fatigue >= 88 || this.energy <= 12;
  }

  get restless(): boolean {
    return this.boredom >= 55;
  }

  get curious(): boolean {
    return this.curiosity >= 60;
  }

  /** Humeur dérivée simple pour les considerations. */
  get mood(): "tired" | "playful" | "focused" | "calm" {
    if (this.exhausted || this.tired) return "tired";
    if (this.boredom > 60 && this.energy > 40) return "playful";
    if (this.fatigue > 40 && this.energy > 35) return "focused";
    return "calm";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
