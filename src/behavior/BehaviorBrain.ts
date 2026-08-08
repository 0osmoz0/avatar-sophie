/**
 * Cerveau comportemental : observe → évalue → choisit un Goal.
 *
 * Un seul Goal actif. Les chaînes `then` sont des intentions contextuelles :
 * chaque étape suivante est re-validée (`gate`) avant activation.
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
import { EventBus } from "../core/EventBus";
import { BrainDebug } from "./BrainDebug";

export type BrainEvents = {
  goalFinished: { label: string; failed?: boolean };
  goalFailed: { label: string };
  chainAbandoned: { from: string; next: string; reason: string };
  landed: { at: number };
  userInteract: { kind: string };
  cursorNearby: { dist: number };
  decide: {
    pick: string;
    utility: number;
    reason: string;
  };
};

export interface BrainFrameResult {
  motion: MotionIntent;
  requestState?: StateId;
  forceState?: boolean;
  animationHint?: "followBody";
}

const BUSY_STATES: ReadonlySet<StateId> = new Set([
  "WORK",
  "STUDY",
  "OVERWORK",
  "SLEEP",
  "DANCE",
  "COFFEE",
  "EAT",
  "HANG",
  "FALL",
  "DRAG",
]);

export class BehaviorBrain {
  readonly memory = new Memory();
  readonly events = new EventBus<BrainEvents>();
  readonly #machine: StateMachine;
  readonly #needs: Needs;
  readonly #considerations: Consideration[];

  #goal: Goal | null = null;
  #goalStartedAt = 0;
  #nextDecideAt = 0;
  #idleSince = 0;
  #pendingRecover = false;
  #activityArmed = false;
  #wakeRequested = false;
  #lastCtx: BrainContext | null = null;

  constructor(machine: StateMachine, needs: Needs, considerations = ALL_CONSIDERATIONS) {
    this.#machine = machine;
    this.#needs = needs;
    this.#considerations = considerations;
  }

  get currentGoal(): Goal | null {
    return this.#goal;
  }

  /** Réveille le prochain cycle de décision (événement important). */
  requestWake(kind = "event"): void {
    this.#wakeRequested = true;
    this.#nextDecideAt = 0;
    BrainDebug.log(`wake requested (${kind})`);
  }

  /** Appelé après un atterrissage de chute. */
  notifyLanded(): void {
    this.#pendingRecover = true;
    this.#goal = null;
    this.#activityArmed = false;
    this.events.emit("landed", { at: performance.now() });
    this.requestWake("landed");
  }

  /** Interruption utilisateur (drag). */
  clearGoal(kind = "interrupt"): void {
    if (this.#goal) {
      BrainDebug.log(`clearGoal ${goalLabel(this.#goal)} (${kind})`);
      this.events.emit("userInteract", { kind });
    }
    this.#goal = null;
    this.#activityArmed = false;
    this.requestWake(kind);
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

    this.#lastCtx = {
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

    if (stateId === "DRAG") {
      this.clearGoal("drag");
      return { motion: { kind: "idle" } };
    }

    if (this.#pendingRecover && stateId === "IDLE") {
      this.#pendingRecover = false;
      this.#setGoal({ kind: "activity", state: "SURPRISE", label: "recover" }, now, 20_000);
    }

    const shouldDecide =
      !this.#goal &&
      this.#canDecide(stateId) &&
      (this.#wakeRequested || now >= this.#nextDecideAt);

    if (shouldDecide) {
      this.#wakeRequested = false;
      this.#decide(this.#lastCtx);
    }

    if (!this.#goal) {
      if (BrainDebug.enabled()) {
        BrainDebug.status(
          `idle decide@${Math.max(0, (this.#nextDecideAt - now) / 1000).toFixed(1)}s\n` +
            `e${Math.round(this.#needs.energy)} f${Math.round(this.#needs.fatigue)} ` +
            `b${Math.round(this.#needs.boredom)} c${Math.round(this.#needs.curiosity)}`,
        );
      }
      return { motion: { kind: "idle" } };
    }

    return this.#executeGoal(now, body, cursor, stateId);
  }

  #canDecide(stateId: StateId): boolean {
    if (BUSY_STATES.has(stateId)) return false;
    return stateId === "IDLE" || stateId === "WALK" || stateId === "LOOK_AROUND";
  }

  #decide(ctx: BrainContext): void {
    const scored = this.#considerations
      .map((c) => {
        const raw = c.utility(ctx);
        const noisy = raw * (0.88 + Math.random() * 0.24);
        return {
          c,
          raw,
          u: noisy,
          reason: c.reason?.(ctx) ?? c.id,
          priority: c.priority ?? 0,
        };
      })
      .filter((s) => s.u > 0.05)
      .sort((a, b) => b.u - a.u || b.priority - a.priority);

    const pick = scored[0];
    if (!pick) {
      this.#nextDecideAt = ctx.now + 8000 + Math.random() * 8000;
      BrainDebug.log("no eligible consideration — stay idle");
      return;
    }

    const goal = pick.c.buildGoal(ctx);
    if (pick.c.onComplete) {
      goal.onComplete = { ...pick.c.onComplete, ...goal.onComplete };
    }

    BrainDebug.decision({
      pick: pick.c.id,
      utility: pick.u,
      reason: pick.reason,
      top: scored.slice(0, 3).map((s) => ({
        id: s.c.id,
        u: s.u,
        reason: s.reason,
      })),
      needs: this.#needs.snapshot(),
      stateId: ctx.stateId,
      idleSeconds: ctx.idleSeconds,
    });
    this.events.emit("decide", {
      pick: pick.c.id,
      utility: pick.u,
      reason: pick.reason,
    });

    this.#setGoal(goal, ctx.now, pick.c.cooldownMs ?? 30_000);
  }

  #setGoal(goal: Goal, now: number, cooldownMs = 30_000): void {
    this.#goal = goal;
    this.#goalStartedAt = now;
    this.#activityArmed = false;
    const id = goalLabel(goal);
    this.memory.remember(id, now, cooldownMs);
    // Backoff soft : on ne force pas une nouvelle décision immédiatement.
    const longAct = ["sleep", "work", "study", "dance", "perch"].some((k) => id.includes(k));
    this.#nextDecideAt = now + (longAct ? 14_000 : 8_000) + Math.random() * 12_000;
    BrainDebug.log(`setGoal ${id}`);
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
        if (elapsed >= duration) return this.#finish();
        if (stateId !== "IDLE") return { motion: { kind: "idle" }, requestState: "IDLE" };
        return { motion: { kind: "idle" } };
      }
      case "goTo": {
        const targetX = goal.x;
        const arrived = Math.abs(body.x - targetX) < 10 && body.speed < 5;
        if (arrived) return this.#finish({ next: goal.then });
        if (elapsed > 18) return this.#finish({ failed: true });
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
          return this.#finish({ next: goal.then });
        }
        if (!this.#activityArmed) {
          return { motion: { kind: "idle" }, requestState: goal.state };
        }
        if (elapsed > (goal.duration ?? 24)) {
          this.#activityArmed = false;
          return this.#finish({ next: goal.then });
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
          return {
            motion: { kind: "held", x: body.x, y: body.y },
            requestState: "HANG",
            forceState: true,
          };
        }
        const duration = goal.duration ?? 6;
        if (elapsed >= duration) {
          const next =
            goal.then ??
            ({
              kind: "fall",
              label: "perch-fall",
            } satisfies Goal);
          return this.#finish({ next });
        }
        return { motion: { kind: "held", x: body.x, y: body.y } };
      }
      case "fall": {
        if (stateId !== "FALL") {
          return { motion: { kind: "freefall" }, requestState: "FALL", forceState: true };
        }
        // L'atterrissage passe par notifyLanded (recover) — pas de then forcé.
        if (body.grounded && elapsed > 0.1) return this.#finish({ next: goal.then });
        return { motion: { kind: "freefall" } };
      }
      case "reactCursor": {
        if (goal.mode === "notice") {
          if (stateId !== "CURSOR_NOTICE" && stateId !== "SURPRISE") {
            return { motion: { kind: "idle" }, requestState: "CURSOR_NOTICE" };
          }
          if (elapsed > 2.2) return this.#finish({ next: goal.then });
          body.faceToward(cursor.x);
          return { motion: { kind: "idle" } };
        }
        if (stateId !== "CURSOR_CHASE") {
          return { motion: { kind: "idle" }, requestState: "CURSOR_CHASE" };
        }
        if (elapsed > 10 || cursor.idleSeconds > 3) return this.#finish({ next: goal.then });
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
        return this.#finish();
    }
  }

  #finish(opts?: { next?: Goal; failed?: boolean }): BrainFrameResult {
    const current = this.#goal;
    const label = current ? goalLabel(current) : "none";
    const failed = opts?.failed === true;
    const next = failed ? undefined : opts?.next;

    if (current?.onComplete && !failed) {
      this.#needs.apply(current.onComplete);
    }

    if (failed) {
      BrainDebug.log(`finish ${label} FAILED — abandon chain`);
      this.events.emit("goalFailed", { label });
      this.#goal = null;
      this.#activityArmed = false;
      this.#scheduleBackoff(label);
      return this.#idleResult();
    }

    BrainDebug.log(`finish ${label}${next ? ` → try ${goalLabel(next)}` : ""}`);
    this.events.emit("goalFinished", { label });

    if (next) {
      const ctx = this.#lastCtx;
      if (!ctx || (next.gate && !next.gate(ctx))) {
        const reason = !ctx ? "no-context" : "gate-failed";
        BrainDebug.log(
          `chainAbandoned from=${label} next=${goalLabel(next)} reason=${reason}`,
        );
        this.events.emit("chainAbandoned", {
          from: label,
          next: goalLabel(next),
          reason,
        });
        this.#goal = null;
        this.#activityArmed = false;
        // Préférer idle plutôt que forcer la suite.
        this.#nextDecideAt = (ctx?.now ?? performance.now()) + 5000 + Math.random() * 6000;
        return this.#idleResult();
      }
      // Suite contextuelle OK — cooldown léger seulement (anti-spam d'étape).
      this.#goal = next;
      this.#goalStartedAt = performance.now();
      this.#activityArmed = false;
      this.memory.remember(goalLabel(next), this.#goalStartedAt, 8_000);
      return { motion: { kind: "idle" } };
    }

    this.#goal = null;
    this.#activityArmed = false;
    this.#scheduleBackoff(label);
    return this.#idleResult();
  }

  #scheduleBackoff(label: string): void {
    const now = this.#lastCtx?.now ?? performance.now();
    const longAct = ["sleep", "work", "study", "dance", "perch"].some((k) => label.includes(k));
    this.#nextDecideAt = now + (longAct ? 12_000 : 7_000) + Math.random() * 10_000;
  }

  #idleResult(): BrainFrameResult {
    if (this.#machine.currentId !== "IDLE" && this.#machine.currentId !== "FALL") {
      return { motion: { kind: "idle" }, requestState: "IDLE" };
    }
    return { motion: { kind: "idle" } };
  }
}
