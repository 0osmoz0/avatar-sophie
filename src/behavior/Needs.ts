/**
 * Jauges / drivers de personnalité.
 */

export class Needs {
  energy = 80;
  fatigue = 10;
  boredom = 20;
  affection = 50;
  curiosity = 55;
  social = 40;

  update(dt: number, active: string): void {
    if (active === "IDLE" || active === "LOOK_AROUND" || active === "THINK") {
      this.energy = clamp(this.energy + 1.5 * dt, 0, 100);
      this.boredom = clamp(this.boredom + 4 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 0.8 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity + 1.2 * dt, 0, 100);
    }

    if (active === "SLEEP") {
      this.energy = clamp(this.energy + 14 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 20 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 2 * dt, 0, 100);
    }

    if (active === "WORK" || active === "STUDY" || active === "OVERWORK") {
      this.energy = clamp(this.energy - 4 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue + 6 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 3 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity - 1 * dt, 0, 100);
    }

    if (active === "WALK" || active === "RUN") {
      this.boredom = clamp(this.boredom - 5 * dt, 0, 100);
      this.curiosity = clamp(this.curiosity + 2 * dt, 0, 100);
      this.energy = clamp(this.energy - 1.5 * dt, 0, 100);
    }

    if (active === "DANCE" || active === "CURSOR_CHASE") {
      this.energy = clamp(this.energy - 5 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 10 * dt, 0, 100);
      this.social = clamp(this.social + 3 * dt, 0, 100);
    }

    if (active === "COFFEE") {
      this.energy = clamp(this.energy + 10 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 5 * dt, 0, 100);
    }

    if (active === "HANG" || active === "PUSH" || active === "PULL") {
      this.curiosity = clamp(this.curiosity - 4 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 6 * dt, 0, 100);
    }

    if (active === "PET" || active === "HAPPY" || active === "LOVE" || active === "WAVE") {
      this.affection = clamp(this.affection + 12 * dt, 0, 100);
      this.social = clamp(this.social + 8 * dt, 0, 100);
    }

    // Dérive lente hors interaction sociale.
    this.social = clamp(this.social - 0.4 * dt, 0, 100);
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
