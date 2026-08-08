import type { AnimationId } from "../assets/generated/animations";
import type { MotionIntent } from "../motion/Locomotion";
import { PRIORITY, type PetState, type StateContext, type StateId, type StateResult } from "./types";

/**
 * Un seul état actif à la fois.
 *
 * Une demande n'aboutit que si sa priorité est ≥ celle de l'état courant, sauf
 * si l'état courant refuse explicitement l'interruption (`canInterrupt` → false)
 * ou si `force` est vrai.
 */
export class StateMachine {
  readonly #states = new Map<StateId, PetState>();
  #current: PetState;
  #elapsed = 0;
  #pending: StateId | null = null;

  constructor(initial: PetState, states: PetState[]) {
    for (const state of states) this.#states.set(state.id, state);
    this.#current = initial;
  }

  get currentId(): StateId {
    return this.#current.id;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  start(ctx: Omit<StateContext, "elapsed">): void {
    this.#elapsed = 0;
    this.#current.enter({ ...ctx, elapsed: 0 });
  }

  request(id: StateId, force = false): boolean {
    if (id === this.#current.id) return false;
    if (!this.#states.has(id)) return false;

    if (!force) {
      const nextPriority = PRIORITY[id];
      const currentPriority = PRIORITY[this.#current.id];
      const veto = this.#current.canInterrupt?.(id, nextPriority);
      if (veto === false) return false;
      if (veto !== true && nextPriority < currentPriority) return false;
    }

    this.#pending = id;
    return true;
  }

  update(ctx: Omit<StateContext, "elapsed">, dt: number): StateResult {
    if (this.#pending) {
      this.#transition(this.#pending, { ...ctx, elapsed: this.#elapsed });
      this.#pending = null;
    }

    this.#elapsed += dt;
    const full: StateContext = { ...ctx, elapsed: this.#elapsed };
    const result = this.#current.update(full, dt);

    if (result.transition && result.transition !== this.#current.id) {
      this.#transition(result.transition, full);
      return this.#current.update({ ...ctx, elapsed: this.#elapsed }, 0);
    }

    return result;
  }

  #transition(id: StateId, ctx: StateContext): void {
    const next = this.#states.get(id);
    if (!next || next.id === this.#current.id) return;

    this.#current.exit(ctx);
    this.#current = next;
    this.#elapsed = 0;
    next.enter({ ...ctx, elapsed: 0 });
  }
}

export function idleMotion(): MotionIntent {
  return { kind: "idle" };
}

export function activityResult(
  animation: AnimationId,
  duration: number,
  elapsed: number,
  next: StateId = "IDLE",
): StateResult {
  return {
    animation,
    followsBody: false,
    motion: idleMotion(),
    transition: elapsed >= duration ? next : undefined,
  };
}
