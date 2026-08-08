import { BEHAVIORS, type BehaviorContext, type BehaviorDef } from "./behaviors";
import type { Needs } from "./Needs";
import type { StateId } from "../state/types";
import type { StateMachine } from "../state/StateMachine";

/**
 * LEGACY — non branché.
 *
 * Remplacé par `BehaviorBrain` + considerations (utilité / Needs / Memory).
 * Conservé uniquement comme référence ; ne plus importer depuis `main.ts`.
 *
 * Ordonnanceur de vie autonome.
 *
 * N'agit que depuis IDLE, après une période d'attente aléatoire, et seulement
 * pour les comportements dont le cooldown est écoulé.
 */
export class BehaviorScheduler {
  readonly #machine: StateMachine;
  readonly #needs: Needs;
  readonly #defs: BehaviorDef[];

  #waitUntil = 0;
  #cooldowns = new Map<string, number>();
  #idleSince = 0;

  constructor(machine: StateMachine, needs: Needs, defs: BehaviorDef[] = BEHAVIORS) {
    this.#machine = machine;
    this.#needs = needs;
    this.#defs = defs;
    this.#scheduleWait(performance.now());
  }

  update(now: number, dt: number): void {
    const stateId = this.#machine.currentId;

    if (stateId !== "IDLE") {
      this.#idleSince = 0;
      return;
    }

    this.#idleSince += dt;
    // Reste un peu en idle avant toute décision.
    if (this.#idleSince < 2.5) return;
    if (now < this.#waitUntil) return;

    const ctx: BehaviorContext = {
      hourOfDay: new Date().getHours(),
      needs: this.#needs,
      idleSeconds: this.#idleSince,
    };

    // Fatigue forcée : enchaînement naturel sans tirage.
    if (this.#needs.exhausted) {
      this.#machine.request("YAWN");
      this.#scheduleWait(now);
      return;
    }

    const pick = this.#weightedPick(now, ctx);
    if (pick) {
      this.#machine.request(pick.state);
      this.#cooldowns.set(pick.id, now + pick.cooldown);
    }

    this.#scheduleWait(now);
  }

  #scheduleWait(now: number): void {
    // 8 à 25 secondes entre deux décisions.
    this.#waitUntil = now + 8000 + Math.random() * 17000;
  }

  #weightedPick(now: number, ctx: BehaviorContext): BehaviorDef | null {
    const eligible = this.#defs.filter((def) => {
      const ready = (this.#cooldowns.get(def.id) ?? 0) <= now;
      return ready && (def.condition?.(ctx) ?? true);
    });
    if (eligible.length === 0) return null;

    const total = eligible.reduce((sum, d) => sum + d.weight, 0);
    let roll = Math.random() * total;
    for (const def of eligible) {
      roll -= def.weight;
      if (roll <= 0) return def;
    }
    return eligible[eligible.length - 1] ?? null;
  }

  /** Force un comportement (debug / menu). */
  force(state: StateId): void {
    this.#machine.request(state);
  }
}
