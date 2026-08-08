import { WALK_SPEED } from "../motion/Locomotion";
import { activityResult, idleMotion } from "./StateMachine";
import { PRIORITY, type PetState, type StateContext, type StateResult } from "./types";

export class IdleState implements PetState {
  readonly id = "IDLE" as const;
  readonly priority = PRIORITY.IDLE;

  enter(): void {}
  exit(): void {}

  update(): StateResult {
    return { animation: "idle", followsBody: true, motion: idleMotion() };
  }
}

export class LookAroundState implements PetState {
  readonly id = "LOOK_AROUND" as const;
  readonly priority = PRIORITY.LOOK_AROUND;
  #duration = 4;

  enter(): void {
    this.#duration = 3 + Math.random() * 3;
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    return activityResult("look_around", this.#duration, ctx.elapsed);
  }
}

export class YawnState implements PetState {
  readonly id = "YAWN" as const;
  readonly priority = PRIORITY.YAWN;

  enter(): void {}
  exit(): void {}

  update(ctx: StateContext): StateResult {
    // Baillement unique puis sommeil si vraiment fatigué.
    const next = ctx.needs.tired ? "SLEEP" : "IDLE";
    return activityResult("yawn", 2.5, ctx.elapsed, next);
  }
}

export class WalkState implements PetState {
  readonly id = "WALK" as const;
  readonly priority = PRIORITY.WALK;
  #targetX = 0;

  enter(ctx: StateContext): void {
    this.#targetX = ctx.bounds.randomX();
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    const arrived = Math.abs(ctx.body.x - this.#targetX) < 8 && ctx.body.speed < 4;
    return {
      animation: "walk",
      followsBody: true,
      motion: { kind: "moveTo", x: this.#targetX, speed: WALK_SPEED },
      transition: arrived || ctx.elapsed > 12 ? "IDLE" : undefined,
    };
  }
}

export class FallState implements PetState {
  readonly id = "FALL" as const;
  readonly priority = PRIORITY.FALL;

  enter(ctx: StateContext): void {
    ctx.body.grounded = false;
  }
  exit(): void {}

  canInterrupt(): boolean {
    return false;
  }

  update(ctx: StateContext): StateResult {
    return {
      animation: "fall",
      followsBody: true,
      motion: { kind: "freefall" },
      transition: ctx.body.grounded && ctx.elapsed > 0.05 ? "IDLE" : undefined,
    };
  }
}

export class HangState implements PetState {
  readonly id = "HANG" as const;
  readonly priority = PRIORITY.HANG;

  enter(): void {
    // Position d'ancrage posée par le BehaviorBrain.
  }

  exit(ctx: StateContext): void {
    ctx.body.grounded = false;
  }

  update(ctx: StateContext): StateResult {
    // Le cerveau pilote la fin de HANG (repartir / tomber) — pas de FALL forcé ici.
    return {
      animation: "hang",
      followsBody: false,
      motion: { kind: "held", x: ctx.body.x, y: ctx.body.y },
    };
  }
}

export class SleepState implements PetState {
  readonly id = "SLEEP" as const;
  readonly priority = PRIORITY.SLEEP;
  #duration = 12;

  enter(): void {
    this.#duration = 10 + Math.random() * 14;
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    return activityResult("sleep", this.#duration, ctx.elapsed);
  }
}

export class ActivityState implements PetState {
  constructor(
    readonly id: PetState["id"],
    readonly animation: Parameters<typeof activityResult>[0],
    readonly priority: number,
    readonly minDuration: number,
    readonly maxDuration: number,
  ) {}

  #duration = 6;
  #clip: Parameters<typeof activityResult>[0] = "work";
  static #lastWorkClip: "work" | "work_alt" | null = null;

  enter(): void {
    this.#duration = this.minDuration + Math.random() * (this.maxDuration - this.minDuration);
    if (this.id === "WORK") {
      const options = (["work", "work_alt"] as const).filter(
        (c) => c !== ActivityState.#lastWorkClip,
      );
      const pick = options[Math.floor(Math.random() * options.length)] ?? "work";
      this.#clip = pick;
      ActivityState.#lastWorkClip = pick;
    } else {
      this.#clip = this.animation;
    }
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    if (this.id === "WORK" && ctx.needs.exhausted) {
      return activityResult(this.#clip, 0, ctx.elapsed, "OVERWORK");
    }
    if (this.id === "OVERWORK") {
      return activityResult(this.animation, this.#duration, ctx.elapsed, "YAWN");
    }
    return activityResult(this.#clip, this.#duration, ctx.elapsed);
  }
}

export class DanceState implements PetState {
  readonly id = "DANCE" as const;
  readonly priority = PRIORITY.DANCE;
  #clip: "dance1" | "dance2" | "dance3" | "dance4" | "dance5" | "dance6" = "dance1";
  #duration = 8;
  static #lastClip: string | null = null;

  enter(): void {
    const clips = ["dance1", "dance2", "dance3", "dance4", "dance5", "dance6"] as const;
    const pool = clips.filter((c) => c !== DanceState.#lastClip);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? clips[0]!;
    this.#clip = pick;
    DanceState.#lastClip = pick;
    this.#duration = 6 + Math.random() * 8;
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    return activityResult(this.#clip, this.#duration, ctx.elapsed);
  }
}

export class CursorNoticeState implements PetState {
  readonly id = "CURSOR_NOTICE" as const;
  readonly priority = PRIORITY.CURSOR_NOTICE;

  enter(ctx: StateContext): void {
    ctx.body.faceToward(ctx.cursor.x);
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    // Pas d'auto-escalade vers CURSOR_CHASE : seul le BehaviorBrain choisit notice vs chase.
    ctx.body.faceToward(ctx.cursor.x);
    const dist = ctx.cursor.distanceTo(ctx.body.x, ctx.body.y - 80);
    if (ctx.elapsed > 2.5 || dist > 450) {
      return activityResult("surprise", 0, ctx.elapsed);
    }
    return { animation: "surprise", followsBody: false, motion: idleMotion() };
  }
}

export class CursorChaseState implements PetState {
  readonly id = "CURSOR_CHASE" as const;
  readonly priority = PRIORITY.CURSOR_CHASE;
  #idleFor = 0;

  enter(): void {
    this.#idleFor = 0;
  }
  exit(): void {}

  update(ctx: StateContext): StateResult {
    const targetX = ctx.cursor.x;
    const dist = Math.abs(targetX - ctx.body.x);

    if (!ctx.cursor.moving) this.#idleFor += 1 / 60;
    else this.#idleFor = 0;

    if (this.#idleFor > 3 || ctx.elapsed > 18 || dist > 700) {
      return {
        animation: "chase",
        followsBody: true,
        motion: idleMotion(),
        transition: "IDLE",
      };
    }

    if (dist < 36) {
      return {
        animation: "happy",
        followsBody: false,
        motion: idleMotion(),
        transition: ctx.elapsed > 0.8 ? "HAPPY" : undefined,
      };
    }

    return {
      animation: "chase",
      followsBody: true,
      motion: {
        kind: "follow",
        x: targetX,
        speed: dist > 200 ? 230 : 140,
        stopDistance: 28,
      },
    };
  }
}

export class DragState implements PetState {
  readonly id = "DRAG" as const;
  readonly priority = PRIORITY.DRAG;

  enter(ctx: StateContext): void {
    ctx.body.grounded = false;
    ctx.body.vx = 0;
    ctx.body.vy = 0;
  }
  exit(): void {}

  canInterrupt(by: string): boolean {
    return by === "FALL";
  }

  update(ctx: StateContext): StateResult {
    return {
      animation: "drag",
      followsBody: false,
      motion: { kind: "held", x: ctx.body.x, y: ctx.body.y },
    };
  }
}

export class ReactionState implements PetState {
  constructor(
    readonly id: PetState["id"],
    readonly animation: Parameters<typeof activityResult>[0],
    readonly priority: number,
    readonly duration = 2.2,
  ) {}

  enter(): void {}
  exit(): void {}

  update(ctx: StateContext): StateResult {
    return activityResult(this.animation, this.duration, ctx.elapsed);
  }
}

export function createAllStates(): PetState[] {
  return [
    new IdleState(),
    new LookAroundState(),
    new YawnState(),
    new WalkState(),
    new FallState(),
    new HangState(),
    new SleepState(),
    new ActivityState("COFFEE", "coffee", PRIORITY.COFFEE, 6, 12),
    new ActivityState("WORK", "work", PRIORITY.WORK, 8, 16),
    new ActivityState("OVERWORK", "overwork", PRIORITY.OVERWORK, 5, 9),
    new ActivityState("STUDY", "study", PRIORITY.STUDY, 8, 14),
    new ActivityState("EAT", "eat", PRIORITY.EAT, 5, 10),
    new ActivityState("THINK", "think", PRIORITY.THINK, 4, 8),
    new ActivityState("PUSH", "push", PRIORITY.PUSH, 4, 7),
    new ActivityState("PULL", "pull", PRIORITY.PULL, 4, 7),
    new DanceState(),
    new CursorNoticeState(),
    new CursorChaseState(),
    new DragState(),
    new ReactionState("PET", "happy", PRIORITY.PET, 2.4),
    new ReactionState("POKE", "angry", PRIORITY.POKE, 2),
    new ReactionState("WAVE", "wave", PRIORITY.WAVE, 2.2),
    new ReactionState("LOVE", "love", PRIORITY.LOVE, 2.5),
    new ReactionState("BLOW_KISS", "blow_kiss", PRIORITY.BLOW_KISS, 2.2),
    new ReactionState("HAPPY", "happy", PRIORITY.HAPPY, 2),
    new ReactionState("EXCITED", "excited", PRIORITY.EXCITED, 2.2),
    new ReactionState("ANGRY", "angry", PRIORITY.ANGRY, 2),
    new ReactionState("CRYING", "crying", PRIORITY.CRYING, 3),
    new ReactionState("SURPRISE", "surprise", PRIORITY.SURPRISE, 1.5),
  ];
}
