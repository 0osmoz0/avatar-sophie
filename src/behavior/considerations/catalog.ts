import type { Consideration, BrainContext } from "./types";
import type { Goal } from "../Goal";
import type { NeedsDeltas } from "../Needs";
import type { StateId } from "../../state/types";

function pen(ctx: BrainContext, id: string): number {
  return 1 - ctx.memory.recencyPenalty(id) * 0.85;
}

function ready(ctx: BrainContext, id: string): boolean {
  return ctx.memory.ready(id, ctx.now);
}

function n01(value: number): number {
  return Math.min(1, Math.max(0, value / 100));
}

/** Gates de chaîne — revalidés au moment d'activer l'étape. */
const gates = {
  stillTired: (ctx: BrainContext) => ctx.needs.tired || ctx.needs.fatigue >= 55,
  wantsCoffee: (ctx: BrainContext) =>
    (ctx.needs.tired || ctx.needs.fatigue >= 50 || ctx.needs.energy <= 45) &&
    ready(ctx, "coffee"),
  windowStillNear: (ctx: BrainContext) => {
    const w = ctx.world.nearestWindow;
    if (!w) return false;
    const dist = Math.hypot(
      w.x + w.width / 2 - ctx.body.x,
      w.y + w.height / 2 - (ctx.body.y - 80),
    );
    return dist < 750;
  },
  edgeStillNear: (ctx: BrainContext) => {
    const e = ctx.world.nearestEdge;
    if (!e) return false;
    return Math.abs(e.x - ctx.body.x) < 420;
  },
  notInterrupted: (ctx: BrainContext) => ctx.stateId !== "DRAG",
  curiosityOk: (ctx: BrainContext) => ctx.needs.curiosity >= 35,
  boredomWalk: (ctx: BrainContext) => ctx.needs.boredom >= 25 || ctx.idleSeconds > 4,
};

export const idleHere: Consideration = {
  id: "idle",
  priority: 0,
  cooldownMs: 10_000,
  reason: (ctx) =>
    `calm pause boredom=${ctx.needs.boredom.toFixed(0)} idle=${ctx.idleSeconds.toFixed(1)}s`,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    // Idle un peu plus attractif quand rien ne presse — évite le spam d'anims.
    const calm = (100 - ctx.needs.boredom) / 100;
    const base = ctx.idleSeconds < 2 ? 0.35 : 0.22 + calm * 0.35;
    return base * pen(ctx, this.id);
  },
  buildGoal: () => ({
    kind: "idle",
    duration: 3.5 + Math.random() * 5,
    label: "idle",
  }),
};

export const walkSomewhere: Consideration = {
  id: "walk",
  priority: 1,
  cooldownMs: 14_000,
  reason: (ctx) =>
    `boredom=${ctx.needs.boredom.toFixed(0)} idle=${ctx.idleSeconds.toFixed(1)}s explore`,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const restlessness = n01(ctx.needs.boredom);
    const settled = ctx.idleSeconds > 8 ? 0.35 : ctx.idleSeconds > 4 ? 0.15 : 0;
    return (0.18 + restlessness * 0.75 + settled) * pen(ctx, this.id);
  },
  onComplete: { boredom: -8, curiosity: 4 },
  buildGoal(ctx) {
    const floors = ctx.world.points.filter((p) => p.kind === "floor" || p.kind === "corner");
    const pick = floors[Math.floor(Math.random() * Math.max(1, floors.length))];
    const x = pick?.x ?? ctx.world.width * (0.2 + Math.random() * 0.6);
    return {
      kind: "goTo",
      x,
      y: ctx.world.height,
      label: "walk",
      then: {
        kind: "idle",
        duration: 1.2 + Math.random() * 2,
        label: "arrive",
        gate: gates.boredomWalk,
      },
    };
  },
};

export const lookAround: Consideration = {
  id: "look",
  priority: 1,
  cooldownMs: 22_000,
  reason: (ctx) => `curiosity=${ctx.needs.curiosity.toFixed(0)} glance`,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    return (0.12 + n01(ctx.needs.curiosity) * 0.45 + n01(ctx.needs.boredom) * 0.15) *
      pen(ctx, this.id);
  },
  onComplete: { curiosity: -6, boredom: -4 },
  buildGoal: () => ({ kind: "activity", state: "LOOK_AROUND", label: "look" }),
};

function activity(opts: {
  id: string;
  state: StateId;
  cooldownMs: number;
  priority?: number;
  score: (ctx: BrainContext) => number;
  reason: (ctx: BrainContext) => string;
  onComplete?: NeedsDeltas;
  then?: (ctx: BrainContext) => Goal | undefined;
}): Consideration {
  return {
    id: opts.id,
    cooldownMs: opts.cooldownMs,
    priority: opts.priority ?? 0,
    onComplete: opts.onComplete,
    reason: opts.reason,
    utility(ctx) {
      if (!ready(ctx, opts.id)) return 0;
      return Math.max(0, opts.score(ctx)) * pen(ctx, opts.id);
    },
    buildGoal(ctx) {
      const goal: Goal = {
        kind: "activity",
        state: opts.state,
        label: opts.id,
        then: opts.then?.(ctx),
      };
      return goal;
    },
  };
}

/** WORK → YAWN? → COFFEE? — chaque étape revalidée. */
export const work = activity({
  id: "work",
  state: "WORK",
  cooldownMs: 140_000,
  priority: 2,
  reason: (ctx) =>
    `mood=${ctx.needs.mood} fatigue=${ctx.needs.fatigue.toFixed(0)} focus block`,
  score: (ctx) => {
    if (ctx.hour < 9 || ctx.hour > 18) return 0;
    if (ctx.needs.exhausted) return 0;
    if (ctx.needs.energy < 25) return 0;
    return (
      0.18 +
      (ctx.needs.mood === "focused" ? 0.5 : 0.12) +
      n01(ctx.needs.boredom) * 0.25 +
      (1 - n01(ctx.needs.fatigue)) * 0.15
    );
  },
  onComplete: { boredom: -12, curiosity: -4 },
  then: () => ({
    kind: "activity",
    state: "YAWN",
    label: "yawn",
    gate: (ctx) => gates.stillTired(ctx) && gates.notInterrupted(ctx) && ready(ctx, "yawn"),
    onComplete: { fatigue: 2 },
    then: {
      kind: "activity",
      state: "COFFEE",
      label: "coffee",
      gate: (ctx) => gates.wantsCoffee(ctx) && gates.notInterrupted(ctx),
      onComplete: { energy: 8, fatigue: -10 },
    },
  }),
});

export const study = activity({
  id: "study",
  state: "STUDY",
  cooldownMs: 160_000,
  priority: 1,
  reason: (ctx) => `curiosity=${ctx.needs.curiosity.toFixed(0)} study`,
  score: (ctx) => {
    if (ctx.hour < 8 || ctx.hour > 22) return 0;
    if (ctx.needs.exhausted) return 0;
    return 0.12 + n01(ctx.needs.curiosity) * 0.4;
  },
  onComplete: { curiosity: -10, boredom: -6 },
});

export const coffee = activity({
  id: "coffee",
  state: "COFFEE",
  cooldownMs: 240_000,
  priority: 3,
  reason: (ctx) =>
    `tired=${ctx.needs.tired} energy=${ctx.needs.energy.toFixed(0)} caffeine`,
  score: (ctx) => {
    if (!ctx.needs.tired && ctx.needs.fatigue < 45) return 0;
    if (ctx.hour >= 7 && ctx.hour <= 11) {
      return 0.28 + (ctx.needs.tired ? 0.45 : 0.15);
    }
    return ctx.needs.tired ? 0.32 : 0;
  },
  onComplete: { energy: 10, fatigue: -12 },
});

export const eat = activity({
  id: "eat",
  state: "EAT",
  cooldownMs: 220_000,
  priority: 2,
  reason: (ctx) => `hour=${ctx.hour} mealtime`,
  score: (ctx) => {
    if (![8, 12, 13, 19, 20].includes(ctx.hour)) return 0;
    return 0.28 + n01(100 - ctx.needs.energy) * 0.2;
  },
  onComplete: { energy: 12, boredom: -5 },
});

export const think = activity({
  id: "think",
  state: "THINK",
  cooldownMs: 70_000,
  priority: 0,
  reason: (ctx) => `curiosity=${ctx.needs.curiosity.toFixed(0)} ponder`,
  score: (ctx) => 0.1 + n01(ctx.needs.curiosity) * 0.28,
  onComplete: { curiosity: -4 },
});

export const dance = activity({
  id: "dance",
  state: "DANCE",
  cooldownMs: 420_000,
  priority: 1,
  reason: (ctx) =>
    `boredom=${ctx.needs.boredom.toFixed(0)} energy=${ctx.needs.energy.toFixed(0)} dance`,
  score: (ctx) => {
    if (ctx.needs.boredom < 55) return 0;
    if (ctx.needs.energy < 35) return 0;
    if (ctx.memory.recentlyDid("dance", 5)) return 0;
    return 0.08 + n01(ctx.needs.boredom) * 0.55 + n01(ctx.needs.energy) * 0.15;
  },
  onComplete: { boredom: -22, energy: -8, social: 6 },
});

export const sleep = activity({
  id: "sleep",
  state: "SLEEP",
  cooldownMs: 320_000,
  priority: 5,
  reason: (ctx) =>
    `fatigue=${ctx.needs.fatigue.toFixed(0)} energy=${ctx.needs.energy.toFixed(0)} hour=${ctx.hour}`,
  score: (ctx) => {
    // Quasi impossible juste après un sleep.
    if (!ready(ctx, "sleep")) return 0;
    if (ctx.memory.recentlyDid("sleep", 4)) return 0;
    const night = ctx.hour >= 23 || ctx.hour < 6;
    if (!(ctx.needs.tired || ctx.needs.exhausted || night)) return 0;
    // Faible fatigue + ennui : ne pas dormir.
    if (ctx.needs.fatigue < 40 && ctx.needs.energy > 50 && !night) return 0;
    return (
      0.45 +
      (ctx.needs.exhausted ? 0.55 : n01(ctx.needs.fatigue) * 0.45) +
      (1 - n01(ctx.needs.energy)) * 0.25 +
      (night ? 0.2 : 0)
    );
  },
  onComplete: { energy: 25, fatigue: -30, boredom: -8 },
});

export const yawn = activity({
  id: "yawn",
  state: "YAWN",
  cooldownMs: 100_000,
  priority: 4,
  reason: (ctx) => `fatigue=${ctx.needs.fatigue.toFixed(0)} tired yawn`,
  score: (ctx) => {
    if (!ctx.needs.tired && !(ctx.hour >= 22 || ctx.hour < 7)) return 0;
    if (ctx.memory.recentlyDid("sleep", 3)) return 0;
    return 0.3 + n01(ctx.needs.fatigue) * 0.4;
  },
});

/**
 * WALK → perch (HANG) → fall — SURPRISE via notifyLanded.
 * Chaque étape peut être abandonnée si le bord n'a plus de sens.
 */
export const perchEdge: Consideration = {
  id: "perch",
  priority: 2,
  cooldownMs: 260_000,
  reason: (ctx) =>
    `curiosity=${ctx.needs.curiosity.toFixed(0)} edge=${ctx.world.nearestEdge ? "yes" : "no"}`,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (!ctx.world.nearestEdge) return 0;
    if (ctx.needs.curiosity < 40) return 0;
    return (0.08 + n01(ctx.needs.curiosity) * 0.55 + n01(ctx.needs.boredom) * 0.15) *
      pen(ctx, this.id);
  },
  onComplete: { curiosity: -14, boredom: -10 },
  buildGoal(ctx) {
    const anchor = ctx.world.nearestEdge!;
    return {
      kind: "goTo",
      x: anchor.x,
      label: "perch-approach",
      then: {
        kind: "perch",
        anchor,
        duration: 5 + Math.random() * 6,
        label: "perch",
        gate: (c) => gates.edgeStillNear(c) && gates.curiosityOk(c) && gates.notInterrupted(c),
        then: {
          kind: "fall",
          label: "perch-fall",
          gate: (c) => gates.notInterrupted(c) && c.stateId === "HANG",
        },
      },
    };
  },
};

export const investigateWindow: Consideration = {
  id: "window",
  priority: 3,
  cooldownMs: 100_000,
  reason: (ctx) => {
    const w = ctx.world.nearestWindow;
    return `curiosity=${ctx.needs.curiosity.toFixed(0)} window=${w ? "near" : "none"}`;
  },
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const w = ctx.world.nearestWindow;
    if (!w) return 0;
    if (ctx.needs.curiosity < 45 && ctx.needs.boredom < 50) return 0;
    const dist = Math.hypot(
      w.x + w.width / 2 - ctx.body.x,
      w.y + w.height / 2 - (ctx.body.y - 80),
    );
    if (dist > 700) return 0;
    return (
      (0.12 + n01(ctx.needs.curiosity) * 0.55 + n01(ctx.needs.boredom) * 0.2) *
      (1 - dist / 900) *
      pen(ctx, this.id)
    );
  },
  onComplete: { curiosity: -12, boredom: -8 },
  buildGoal(ctx) {
    const w = ctx.world.nearestWindow!;
    const side = ctx.body.x < w.x + w.width / 2 ? w.x + 24 : w.x + w.width - 24;
    const mime: StateId = Math.random() < 0.5 ? "PUSH" : "PULL";
    return {
      kind: "goTo",
      x: side,
      label: "window-approach",
      then: {
        kind: "activity",
        state: mime,
        label: "window-mime",
        gate: (c) => gates.windowStillNear(c) && gates.curiosityOk(c) && gates.notInterrupted(c),
        then: {
          kind: "idle",
          duration: 1.5,
          label: "window-done",
          gate: gates.notInterrupted,
        },
      },
    };
  },
};

export const reactCursor: Consideration = {
  id: "cursor",
  priority: 2,
  cooldownMs: 75_000,
  reason: (ctx) =>
    `social=${ctx.needs.social.toFixed(0)} cursorDist≈${Math.round(
      ctx.cursor.distanceTo(ctx.body.x, ctx.body.y - 80),
    )}`,
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (BUSY_FOR_CURSOR.has(ctx.stateId)) return 0;
    const headY = ctx.body.y - 80;
    const dist = ctx.cursor.distanceTo(ctx.body.x, headY);
    if (dist > 380) return 0;
    // Souvent ignore même proche — curseur secondaire.
    if (Math.random() < 0.7) return 0;
    const social = n01(ctx.needs.social);
    const curious = n01(ctx.needs.curiosity);
    if (!ctx.cursor.moving) return (0.04 + social * 0.08) * pen(ctx, this.id);
    return (0.06 + curious * 0.22 + social * 0.1) * (1 - dist / 400) * pen(ctx, this.id);
  },
  buildGoal(ctx) {
    const chase = ctx.needs.curious && ctx.cursor.moving && Math.random() < 0.28;
    return {
      kind: "reactCursor",
      mode: chase ? "chase" : "notice",
      label: chase ? "cursor-chase" : "cursor-notice",
    };
  },
};

const BUSY_FOR_CURSOR = new Set<StateId>([
  "SLEEP",
  "WORK",
  "STUDY",
  "DANCE",
  "DRAG",
  "HANG",
  "COFFEE",
  "FALL",
]);

export const recoverFall: Consideration = {
  id: "recover",
  utility() {
    return 0;
  },
  reason: () => "landed recover",
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
