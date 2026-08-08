/**
 * Jauges partagées.
 *
 * Elles rendent l'enchaînement travail → fatigue → sommeil crédible plutôt que
 * purement aléatoire.
 */
export class Needs {
  energy = 80;
  fatigue = 10;
  boredom = 20;
  affection = 50;

  update(dt: number, active: string): void {
    // Repos léger hors activité intense.
    if (active === "IDLE" || active === "LOOK_AROUND") {
      this.energy = clamp(this.energy + 2 * dt, 0, 100);
      this.boredom = clamp(this.boredom + 3 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 1 * dt, 0, 100);
    }

    if (active === "SLEEP") {
      this.energy = clamp(this.energy + 12 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 18 * dt, 0, 100);
    }

    if (active === "WORK" || active === "STUDY" || active === "OVERWORK") {
      this.energy = clamp(this.energy - 4 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue + 6 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 2 * dt, 0, 100);
    }

    if (active === "DANCE" || active === "CURSOR_CHASE" || active === "RUN") {
      this.energy = clamp(this.energy - 5 * dt, 0, 100);
      this.boredom = clamp(this.boredom - 8 * dt, 0, 100);
    }

    if (active === "COFFEE") {
      this.energy = clamp(this.energy + 8 * dt, 0, 100);
      this.fatigue = clamp(this.fatigue - 4 * dt, 0, 100);
    }

    if (active === "PET" || active === "HAPPY" || active === "LOVE") {
      this.affection = clamp(this.affection + 10 * dt, 0, 100);
    }
  }

  get tired(): boolean {
    return this.fatigue >= 70 || this.energy <= 25;
  }

  get exhausted(): boolean {
    return this.fatigue >= 90 || this.energy <= 10;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
