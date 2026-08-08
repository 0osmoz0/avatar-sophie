import type { Consideration, BrainContext } from "./types";
import type { StateId } from "../../state/types";

function pen(ctx: BrainContext, id: string): number {
  return 1 - ctx.memory.recencyPenalty(id) * 0.85;
}

function ready(ctx: BrainContext, id: string): boolean {
  return ctx.memory.ready(id, ctx.now);
}

export const idleHere: Consideration = {
  id: "idle",
  cooldownMs: 8_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (ctx.idleSeconds < 1.5) return 0.2;
    return (0.35 + (100 - ctx.needs.boredom) / 200) * pen(ctx, this.id);
  },
  buildGoal: () => ({ kind: "idle", duration: 3 + Math.random() * 4, label: "idle" }),
};

export const walkSomewhere: Consideration = {
  id: "walk",
  cooldownMs: 12_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const restlessness = ctx.needs.boredom / 100;
    const settled = ctx.idleSeconds > 8 ? 0.4 : 0;
    return (0.25 + restlessness * 0.7 + settled) * pen(ctx, this.id);
  },
  buildGoal(ctx) {
    const floors = ctx.world.points.filter((p) => p.kind === "floor" || p.kind === "corner");
    const pick = floors[Math.floor(Math.random() * Math.max(1, floors.length))];
    const x = pick?.x ?? ctx.world.width * (0.2 + Math.random() * 0.6);
    return {
      kind: "goTo",
      x,
      y: ctx.world.height,
      label: "walk",
      then: { kind: "idle", duration: 1.5, label: "arrive" },
    };
  },
};

export const lookAround: Consideration = {
  id: "look",
  cooldownMs: 20_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    return (0.15 + ctx.needs.curiosity / 250) * pen(ctx, this.id);
  },
  buildGoal: () => ({ kind: "activity", state: "LOOK_AROUND", label: "look" }),
};

function activity(
  id: string,
  state: StateId,
  cooldownMs: number,
  score: (ctx: BrainContext) => number,
): Consideration {
  return {
    id,
    cooldownMs,
    utility(ctx) {
      if (!ready(ctx, id)) return 0;
      return Math.max(0, score(ctx)) * pen(ctx, id);
    },
    buildGoal: () => ({ kind: "activity", state, label: id }),
  };
}

export const work = activity("work", "WORK", 120_000, (ctx) => {
  if (ctx.hour < 9 || ctx.hour > 18) return 0;
  if (ctx.needs.exhausted) return 0;
  return 0.2 + (ctx.needs.mood === "focused" ? 0.45 : 0.15) + ctx.needs.boredom / 300;
});

export const study = activity("study", "STUDY", 150_000, (ctx) => {
  if (ctx.hour < 8 || ctx.hour > 22) return 0;
  return 0.15 + ctx.needs.curiosity / 280;
});

export const coffee = activity("coffee", "COFFEE", 180_000, (ctx) => {
  if (ctx.hour < 7 || ctx.hour > 11) return ctx.needs.tired ? 0.35 : 0;
  return 0.25 + (ctx.needs.tired ? 0.4 : 0.1);
});

export const eat = activity("eat", "EAT", 200_000, (ctx) => {
  if (![8, 12, 13, 19, 20].includes(ctx.hour)) return 0;
  return 0.3;
});

export const think = activity("think", "THINK", 60_000, (ctx) => 0.12 + ctx.needs.curiosity / 400);

export const dance = activity("dance", "DANCE", 300_000, (ctx) => {
  if (ctx.needs.boredom < 50) return 0;
  return 0.1 + ctx.needs.boredom / 200;
});

export const sleep = activity("sleep", "SLEEP", 180_000, (ctx) => {
  if (!(ctx.needs.tired || ctx.hour >= 23 || ctx.hour < 6)) return 0;
  if (ctx.memory.recentlyDid("sleep")) return 0;
  return 0.5 + (ctx.needs.exhausted ? 0.5 : ctx.needs.fatigue / 200);
});

export const yawn = activity("yawn", "YAWN", 90_000, (ctx) => {
  if (!ctx.needs.tired && ctx.hour < 22 && ctx.hour >= 7) return 0;
  return 0.35 + ctx.needs.fatigue / 250;
});

export const perchEdge: Consideration = {
  id: "perch",
  cooldownMs: 240_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (!ctx.world.nearestEdge) return 0;
    const curiosity = ctx.needs.curiosity / 100;
    return (0.1 + curiosity * 0.55) * pen(ctx, this.id);
  },
  buildGoal(ctx) {
    const anchor = ctx.world.nearestEdge!;
    return {
      kind: "goTo",
      x: anchor.x,
      label: "perch-approach",
      then: { kind: "perch", anchor, duration: 5 + Math.random() * 6, label: "perch" },
    };
  },
};

export const investigateWindow: Consideration = {
  id: "window",
  cooldownMs: 90_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const w = ctx.world.nearestWindow;
    if (!w) return 0;
    const dist = Math.hypot(w.x + w.width / 2 - ctx.body.x, w.y + w.height / 2 - (ctx.body.y - 80));
    if (dist > 700) return 0;
    return (0.15 + ctx.needs.curiosity / 220) * (1 - dist / 900) * pen(ctx, this.id);
  },
  buildGoal(ctx) {
    const w = ctx.world.nearestWindow!;
    const side = ctx.body.x < w.x + w.width / 2 ? w.x + 24 : w.x + w.width - 24;
    const mime: StateId = Math.random() < 0.5 ? "PUSH" : "PULL";
    return {
      kind: "goTo",
      x: side,
      label: "window-approach",
      then: { kind: "activity", state: mime, label: "window-mime" },
    };
  },
};

export const reactCursor: Consideration = {
  id: "cursor",
  cooldownMs: 60_000,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    // Occupée : ignore.
    if (["SLEEP", "WORK", "STUDY", "DANCE", "DRAG", "HANG", "COFFEE"].includes(ctx.stateId)) {
      return 0;
    }
    const headY = ctx.body.y - 80;
    const dist = ctx.cursor.distanceTo(ctx.body.x, headY);
    if (dist > 380) return 0;
    // Souvent ignore même proche.
    if (Math.random() < 0.65) return 0;
    const social = ctx.needs.social / 100;
    const curious = ctx.needs.curiosity / 100;
    if (!ctx.cursor.moving) return (0.05 + social * 0.1) * pen(ctx, this.id);
    return (0.08 + curious * 0.25 + social * 0.1) * (1 - dist / 400) * pen(ctx, this.id);
  },
  buildGoal(ctx) {
    const chase = ctx.needs.curious && ctx.cursor.moving && Math.random() < 0.35;
    return {
      kind: "reactCursor",
      mode: chase ? "chase" : "notice",
      label: chase ? "cursor-chase" : "cursor-notice",
    };
  },
};

export const recoverFall: Consideration = {
  id: "recover",
  utility(ctx) {
    // Déclenché explicitement via événement — utilité nulle en poll normal.
    void ctx;
    return 0;
  },
  buildGoal: () => ({ kind: "activity", state: "SURPRISE", label: "recover" }),
};

export const ALL_CONSIDERATIONS: Consideration[] = [
  idleHere,
  walkSomewhere,
  lookAround,
  work,
  study,
  coffee,
  eat,
  think,
  dance,
  sleep,
  yawn,
  perchEdge,
  investigateWindow,
  reactCursor,
];
