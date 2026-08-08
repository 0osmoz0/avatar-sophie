/**
 * Cerveau comportemental : observe → évalue → choisit un Goal.
 */

import type { Goal } from "./Goal";
import { goalLabel } from "./Goal";
import { Memory } from "./Memory";
import type { Needs } from "./Needs";
import type { Body } from "../motion/Body";
import type { CursorTracker } from "../input/CursorTracker";
import type { WorldSnapshot } from "../world/types";
import type { StateId } from "../state/types";
import type { StateMachine } from "../state/StateMachine";
import { ALL_CONSIDERATIONS } from "./considerations/catalog";
import type { BrainContext, Consideration } from "./considerations/types";
import { WALK_SPEED, RUN_SPEED, type MotionIntent } from "../motion/Locomotion";

export interface BrainFrameResult {
  motion: MotionIntent;
  requestState?: StateId;
  forceState?: boolean;
  animationHint?: "followBody";
}

/**
 * Exécute un Goal courant et demande une nouvelle décision quand il est fini.
 */
export class BehaviorBrain {
  readonly memory = new Memory();
  readonly #machine: StateMachine;
  readonly #needs: Needs;
  readonly #considerations: Consideration[];

  #goal: Goal | null = null;
  #goalStartedAt = 0;
  #nextDecideAt = 0;
  #idleSince = 0;
  #pendingRecover = false;
  #activityArmed = false;

  constructor(machine: StateMachine, needs: Needs, considerations = ALL_CONSIDERATIONS) {
    this.#machine = machine;
    this.#needs = needs;
    this.#considerations = considerations;
  }

  get currentGoal(): Goal | null {
    return this.#goal;
  }

  /** Appelé après un atterrissage de chute. */
  notifyLanded(): void {
    this.#pendingRecover = true;
    this.#goal = null;
  }

  /** Interruption utilisateur (drag). */
  clearGoal(): void {
    this.#goal = null;
    this.#activityArmed = false;
  }

  update(
    now: number,
    dt: number,
    body: Body,
    cursor: CursorTracker,
    world: WorldSnapshot,
  ): BrainFrameResult {
    const stateId = this.#machine.currentId;

    if (stateId === "IDLE") this.#idleSince += dt;
    else this.#idleSince = 0;

    if (stateId === "DRAG") {
      this.clearGoal();
      return { motion: { kind: "idle" } };
    }

    if (this.#pendingRecover && stateId === "IDLE") {
      this.#pendingRecover = false;
      this.#setGoal({ kind: "activity", state: "SURPRISE", label: "recover" }, now);
    }

    if (!this.#goal && now >= this.#nextDecideAt && this.#canDecide(stateId)) {
      this.#decide(now, body, cursor, world, stateId);
    }

    if (!this.#goal) {
      return { motion: { kind: "idle" } };
    }

    return this.#executeGoal(now, body, cursor, stateId);
  }

  #canDecide(stateId: StateId): boolean {
    return stateId === "IDLE" || stateId === "WALK" || stateId === "LOOK_AROUND";
  }

  #decide(
    now: number,
    body: Body,
    cursor: CursorTracker,
    world: WorldSnapshot,
    stateId: StateId,
  ): void {
    // Fatigue forcée.
    if (this.#needs.exhausted && this.memory.ready("yawn", now)) {
      this.#setGoal({ kind: "activity", state: "YAWN", label: "yawn" }, now, 90_000);
      return;
    }

    const ctx: BrainContext = {
      now,
      body,
      cursor,
      needs: this.#needs,
      memory: this.memory,
      world,
      stateId,
      idleSeconds: this.#idleSince,
      hour: new Date().getHours(),
    };

    const scored = this.#considerations
      .map((c) => ({ c, u: c.utility(ctx) * (0.85 + Math.random() * 0.3) }))
      .filter((s) => s.u > 0.05)
      .sort((a, b) => b.u - a.u);

    const pick = scored[0];
    if (!pick) {
      this.#nextDecideAt = now + 4000 + Math.random() * 4000;
      return;
    }

    const goal = pick.c.buildGoal(ctx);
    this.#setGoal(goal, now, pick.c.cooldownMs ?? 30_000);
  }

  #setGoal(goal: Goal, now: number, cooldownMs = 30_000): void {
    this.#goal = goal;
    this.#goalStartedAt = now;
    this.#activityArmed = false;
    const id = goalLabel(goal);
    this.memory.remember(id, now, cooldownMs);
    this.#nextDecideAt = now + 5000 + Math.random() * 12000;
  }

  #executeGoal(
    now: number,
    body: Body,
    cursor: CursorTracker,
    stateId: StateId,
  ): BrainFrameResult {
    const goal = this.#goal!;
    const elapsed = (now - this.#goalStartedAt) / 1000;

    switch (goal.kind) {
      case "idle": {
        const duration = goal.duration ?? 3;
        if (elapsed >= duration) return this.#finish(undefined);
        if (stateId !== "IDLE") return { motion: { kind: "idle" }, requestState: "IDLE" };
        return { motion: { kind: "idle" } };
      }
      case "goTo": {
        const targetX = goal.x;
        const arrived = Math.abs(body.x - targetX) < 10 && body.speed < 5;
        if (arrived || elapsed > 18) return this.#finish(goal.then);
        if (stateId !== "WALK" && stateId !== "RUN") {
          return {
            motion: { kind: "moveTo", x: targetX, speed: WALK_SPEED },
            requestState: "WALK",
          };
        }
        return {
          motion: { kind: "moveTo", x: targetX, speed: WALK_SPEED },
          animationHint: "followBody",
        };
      }
      case "activity": {
        if (stateId === goal.state) {
          this.#activityArmed = true;
          return { motion: { kind: "idle" } };
        }
        if (this.#activityArmed && stateId === "IDLE") {
          this.#activityArmed = false;
          return this.#finish(undefined);
        }
        if (!this.#activityArmed) {
          return { motion: { kind: "idle" }, requestState: goal.state };
        }
        if (elapsed > (goal.duration ?? 24)) {
          this.#activityArmed = false;
          return this.#finish(undefined);
        }
        return { motion: { kind: "idle" } };
      }
      case "perch": {
        if (stateId !== "HANG") {
          body.x = goal.anchor.x;
          body.y = goal.anchor.y;
          body.facing = goal.anchor.facing;
          body.grounded = false;
          body.vx = 0;
          body.vy = 0;
          return { motion: { kind: "held", x: body.x, y: body.y }, requestState: "HANG", forceState: true };
        }
        const duration = goal.duration ?? 6;
        if (elapsed >= duration) {
          return this.#finish({ kind: "fall", label: "perch-fall" });
        }
        return { motion: { kind: "held", x: body.x, y: body.y } };
      }
      case "fall": {
        if (stateId !== "FALL") {
          return { motion: { kind: "freefall" }, requestState: "FALL", forceState: true };
        }
        if (body.grounded && elapsed > 0.1) return this.#finish(undefined);
        return { motion: { kind: "freefall" } };
      }
      case "reactCursor": {
        if (goal.mode === "notice") {
          if (stateId !== "CURSOR_NOTICE" && stateId !== "SURPRISE") {
            return { motion: { kind: "idle" }, requestState: "CURSOR_NOTICE" };
          }
          if (elapsed > 2.2) return this.#finish(undefined);
          body.faceToward(cursor.x);
          return { motion: { kind: "idle" } };
        }
        // chase
        if (stateId !== "CURSOR_CHASE") {
          return { motion: { kind: "idle" }, requestState: "CURSOR_CHASE" };
        }
        if (elapsed > 10 || cursor.idleSeconds > 3) return this.#finish(undefined);
        return {
          motion: {
            kind: "follow",
            x: cursor.x,
            speed: Math.abs(cursor.x - body.x) > 200 ? RUN_SPEED : 140,
            stopDistance: 28,
          },
          animationHint: "followBody",
        };
      }
      default:
        return this.#finish(undefined);
    }
  }

  #finish(next?: Goal): BrainFrameResult {
    if (next) {
      this.#goal = next;
      this.#goalStartedAt = performance.now();
      this.#activityArmed = false;
      return { motion: { kind: "idle" } };
    }
    this.#goal = null;
    this.#activityArmed = false;
    if (this.#machine.currentId !== "IDLE" && this.#machine.currentId !== "FALL") {
      return { motion: { kind: "idle" }, requestState: "IDLE" };
    }
    return { motion: { kind: "idle" } };
  }
}
