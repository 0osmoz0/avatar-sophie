/**
 * Cerveau comportemental : observe → évalue → choisit un Goal.
 *
 * Un seul Goal actif. Les chaînes `then` sont des intentions contextuelles :
 * chaque étape suivante est re-validée (`gate`) avant activation.
 */

import type { Goal } from "./Goal";
import { goalLabel, goToTimeoutSec } from "./Goal";
import { Memory } from "./Memory";
import type { Needs } from "./Needs";
import type { Body } from "../motion/Body";
import type { CursorTracker } from "../input/CursorTracker";
import type { WorldSnapshot } from "../world/types";
import type { StateId } from "../state/types";
import type { StateMachine } from "../state/StateMachine";
import { ALL_CONSIDERATIONS } from "./considerations/catalog";
import type { BrainContext, Consideration } from "./considerations/types";
import { EnvironmentTracker } from "../environment/EnvironmentContext";
import {
  isPerchAnchorValid,
  type EnvironmentContext,
} from "../environment/EnvironmentContext";
import { WALK_SPEED, RUN_SPEED, type MotionIntent } from "../motion/Locomotion";
import { EventBus } from "../core/EventBus";
import { BrainDebug } from "./BrainDebug";
import { RuntimeAudit } from "./RuntimeAudit";
import {
  emptyInterpretedContext,
  type InterpretedUserContext,
} from "../user/InterpretedUserContext";
import {
  emptyUserActivitySnapshot,
  type UserActivitySnapshot,
} from "../user/UserActivitySnapshot";

export type BrainEvents = {
  goalFinished: { label: string; failed?: boolean };
  goalFailed: { label: string };
  chainAbandoned: { from: string; next: string; reason: string };
  landed: { at: number };
  userInteract: { kind: string };
  cursorNearby: { dist: number };
  userActivityChanged: { kind: string };
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
  "PHONE_CHECK",
  "PHONE_TEXT",
  "PHONE_CALL",
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
  /** Y au sol avant perch — pour redescendre sans chute. */
  #prePerchY = 0;
  /** Label consideration pour logs d'abandon de chaîne. */
  #chainRoot = "";
  readonly #envTracker = new EnvironmentTracker();
  #lastEnvironment: EnvironmentContext | null = null;

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
    const busy = BUSY_STATES.has(this.#machine.currentId);
    RuntimeAudit.softWake(kind, busy);
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
    const busyInterrupted = new Set([
      "SLEEP",
      "WORK",
      "STUDY",
      "DANCE",
      "COFFEE",
      "OVERWORK",
    ]);
    const sid = this.#machine.currentId;
    if (busyInterrupted.has(sid)) {
      // Signal pour considerations angry/crying — pas de cooldown bloquant.
      this.memory.remember("interrupted", performance.now());
      // Observation Phase 5 : drag/tray peuvent couper un busy — tracer seulement.
      RuntimeAudit.interruption(sid, kind, kind === "drag" || kind === "tray");
    }
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
    userActivity: UserActivitySnapshot = emptyUserActivitySnapshot(),
    interpretedContext: InterpretedUserContext = emptyInterpretedContext(userActivity),
  ): BrainFrameResult {
    const stateId = this.#machine.currentId;

    if (stateId === "IDLE") this.#idleSince += dt;
    else this.#idleSince = 0;

    this.memory.update(dt);

    const environment = this.#envTracker.update({
      body,
      world,
      cursor,
      interpreted: interpretedContext,
      userActivity,
      stateId,
      memoryReturned: this.memory.recentWithin("user_returned", now, 45_000),
    });
    this.#lastEnvironment = environment;

    this.#lastCtx = {
      now,
      body,
      cursor,
      needs: this.#needs,
      memory: this.memory,
      world,
      userActivity,
      interpretedContext,
      environment,
      stateId,
      idleSeconds: this.#idleSince,
      hour: new Date().getHours(),
    };

    if (BrainDebug.enabled()) {
      BrainDebug.userActivity(userActivity);
      BrainDebug.context(interpretedContext);
    }

    if (stateId === "DRAG") {
      this.clearGoal("drag");
      return { motion: { kind: "idle" } };
    }

    // Busy orphelin (goal déjà fini, état non décidable) — sortie naturelle
    // pour redonner la main au Brain. Pas un scheduler d'animation.
    if (
      !this.#goal &&
      BUSY_STATES.has(stateId) &&
      stateId !== "FALL" &&
      this.#machine.elapsed > 16
    ) {
      if (stateId === "HANG") this.#dismountFromPerch(body);
      this.requestWake("busyOrphan");
      return {
        motion: { kind: "idle" },
        requestState: "IDLE",
        forceState: true,
      };
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
            `b${Math.round(this.#needs.boredom)} c${Math.round(this.#needs.curiosity)}\n` +
            `${BrainDebug.formatContextShort(interpretedContext)} ` +
            `${userActivity.category}/${userActivity.overallLevel}` +
            (userActivity.userBusy ? " busy" : userActivity.userIdle ? " idleUser" : ""),
        );
      }
      return { motion: { kind: "idle" } };
    }

    return this.#executeGoal(now, body, cursor, stateId);
  }

  /** Wake soft suite à un changement de contexte user — jamais de goal auto. */
  notifyUserActivity(kind: string): void {
    this.events.emit("userActivityChanged", { kind });
    // Wake pour re-scorer ; pas d'animation forcée.
    this.requestWake(`userActivity:${kind}`);
  }

  /** Lecture seule — pour SophieAPI snapshot. */
  get lastEnvironment(): EnvironmentContext | null {
    return this.#lastEnvironment;
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

    if (BrainDebug.enabled()) {
      for (const s of scored.slice(0, 6)) {
        const nov = ctx.memory.noveltyModifier(s.c.id);
        if (nov < 0.88 && s.c.id !== pick.c.id) {
          const age = ctx.memory.ageSec(s.c.id, ctx.now);
          BrainDebug.suppress(s.c.id, "recently_used", {
            ageSec: age ?? undefined,
            novelty: nov,
          });
        }
      }
    }

    const goal = pick.c.buildGoal(ctx);
    if (pick.c.onComplete) {
      goal.onComplete = { ...pick.c.onComplete, ...goal.onComplete };
    }

    const previous = ctx.memory.lastBehavior();
    const chain =
      previous != null ? `${previous}→${pick.c.id}` : pick.c.id;

    BrainDebug.decision(
      {
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
        context: BrainDebug.formatContextShort(ctx.interpretedContext),
        previous,
        novelty: ctx.memory.noveltyLabel(pick.c.id),
        noveltyValue: ctx.memory.noveltyModifier(pick.c.id),
        chain,
        personality: ctx.memory.personalityHint(pick.c.id),
        personalitySnapshot: ctx.memory.personalitySnapshot(),
      },
      this.memory,
      ctx.now,
    );
    RuntimeAudit.decide(pick.c.id, pick.reason, previous);
    this.events.emit("decide", {
      pick: pick.c.id,
      utility: pick.u,
      reason: pick.reason,
    });

    this.#setGoal(goal, ctx.now, pick.c.cooldownMs ?? 30_000, pick.c.id);
  }

  #setGoal(goal: Goal, now: number, cooldownMs = 30_000, memoryId?: string): void {
    this.#goal = goal;
    this.#goalStartedAt = now;
    this.#activityArmed = false;
    const id = memoryId ?? goalLabel(goal);
    this.#chainRoot = memoryId ?? goalLabel(goal);
    // Memory alignée sur l'id de considération (perch / window / walk…).
    this.memory.remember(id, now, cooldownMs);
    const longAct = ["sleep", "work", "study", "dance", "perch", "window"].some((k) =>
      id.includes(k),
    );
    this.#nextDecideAt = now + (longAct ? 14_000 : 8_000) + Math.random() * 12_000;
    BrainDebug.log(`setGoal ${id}`);
    RuntimeAudit.setGoal(id);
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
        const dist = Math.abs(body.x - targetX);
        const budget =
          goal.timeoutSec ??
          goToTimeoutSec(Math.max(dist, Math.abs(body.x - targetX)), WALK_SPEED);

        if (this.#lastCtx && goal.invalidate?.(this.#lastCtx)) {
          return this.#failGoTo("destinationInvalid", dist);
        }

        const arrived = dist < 10 && body.speed < 5;
        if (arrived) return this.#finish({ next: goal.then });
        if (elapsed > budget) return this.#failGoTo("goToTimeout", dist);

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
        const duration = goal.duration ?? 6;
        if (stateId !== "HANG") {
          // Filet HangState → IDLE : ne pas ré-entrer en boucle, terminer le perch.
          if (elapsed >= duration) {
            this.#dismountFromPerch(body);
            const next = this.#chooseAfterPerch();
            if (!next) this.#dismountFromPerch(body);
            return this.#finish({ next });
          }
          this.#prePerchY = body.y;
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
        if (elapsed >= duration) {
          const next = this.#chooseAfterPerch();
          if (!next) this.#dismountFromPerch(body);
          return this.#finish({ next });
        }
        // Surface live : si l'ancre disparaît, ne pas rester en held/void.
        if (this.#lastCtx && !isPerchAnchorValid(this.#lastCtx.world, goal.anchor, body.x)) {
          this.#dismountFromPerch(body);
          this.requestWake("perchSurfaceLost");
          return this.#finish();
        }
        return { motion: { kind: "held", x: body.x, y: body.y } };
      }
      case "fall": {
        if (stateId !== "FALL") {
          return { motion: { kind: "freefall" }, requestState: "FALL", forceState: true };
        }
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

  /** Après HANG : chute contextuelle (pas systématique), sinon redescendre. */
  #chooseAfterPerch(): Goal | undefined {
    const ctx = this.#lastCtx;
    if (!ctx || ctx.stateId === "DRAG") return undefined;
    const fallChance =
      0.32 + (ctx.needs.boredom / 100) * 0.2 + (ctx.needs.curiosity / 100) * 0.15;
    if (Math.random() < fallChance) {
      return {
        kind: "fall",
        label: "perch-fall",
        gate: (c) => c.stateId === "HANG" || c.stateId === "FALL",
      };
    }
    return undefined;
  }

  #dismountFromPerch(body: Body): void {
    body.grounded = true;
    body.vy = 0;
    body.vx = 0;
    if (this.#prePerchY > 0) body.y = this.#prePerchY;
  }

  #failGoTo(reason: string, distance: number): BrainFrameResult {
    const root = this.#chainRoot || goalLabel(this.#goal!);
    BrainDebug.log(
      `chainAbandoned=${root} reason=${reason} distance=${distance.toFixed(0)}`,
    );
    this.events.emit("chainAbandoned", {
      from: root,
      next: goalLabel(this.#goal!),
      reason: `${reason} distance=${Math.round(distance)}`,
    });
    this.#goal = null;
    this.#activityArmed = false;
    this.#scheduleBackoff(root);
    return this.#idleResult();
  }

  #finish(opts?: { next?: Goal; failed?: boolean; reason?: string }): BrainFrameResult {
    const current = this.#goal;
    const label = current ? goalLabel(current) : "none";
    const failed = opts?.failed === true;
    const next = failed ? undefined : opts?.next;

    if (current?.onComplete && !failed) {
      this.#needs.apply(current.onComplete);
    }

    if (failed) {
      const reason = opts?.reason ?? "failed";
      BrainDebug.log(`finish ${label} FAILED reason=${reason}`);
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
          `chainAbandoned=${this.#chainRoot || label} from=${label} next=${goalLabel(next)} reason=${reason}`,
        );
        this.events.emit("chainAbandoned", {
          from: label,
          next: goalLabel(next),
          reason,
        });
        this.#goal = null;
        this.#activityArmed = false;
        this.#nextDecideAt = (ctx?.now ?? performance.now()) + 5000 + Math.random() * 6000;
        return this.#idleResult();
      }
      this.#goal = next;
      this.#goalStartedAt = performance.now();
      this.#activityArmed = false;
      // Étape suivante : cooldown léger seulement (la racine a déjà le vrai CD).
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
    const sid = this.#machine.currentId;
    if (sid !== "IDLE" && sid !== "FALL") {
      // Fin de goal : toujours forcer IDLE — beaucoup d'états ont priority > IDLE
      // (HANG=40, WALK=10, PUSH=30…). Sans force, Sophie reste bloquée sans re-score.
      this.requestWake(sid === "HANG" ? "hangDismount" : "goalComplete");
      return { motion: { kind: "idle" }, requestState: "IDLE", forceState: true };
    }
    return { motion: { kind: "idle" } };
  }
}
