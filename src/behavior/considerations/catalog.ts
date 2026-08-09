import type { Consideration, BrainContext } from "./types";
import type { Goal } from "../Goal";
import { goToTimeoutSec } from "../Goal";
import type { NeedsDeltas } from "../Needs";
import type { StateId } from "../../state/types";
import { userActivityFactor, userHint, withUserContext } from "../../user/activityModifiers";
import { WALK_SPEED } from "../../motion/Locomotion";

function ready(ctx: BrainContext, id: string): boolean {
  return ctx.memory.ready(id, ctx.now);
}

function n01(value: number): number {
  return Math.min(1, Math.max(0, value / 100));
}

function windowHorizDist(ctx: BrainContext): number | null {
  const w = ctx.world.nearestWindow;
  if (!w) return null;
  const cx = w.x + w.width / 2;
  return Math.abs(cx - ctx.body.x);
}

function novelty(ctx: BrainContext, id: string): number {
  return ctx.memory.noveltyModifier(id);
}

/**
 * Boost soft après un comportement récent — jamais de transition forcée.
 * Multiplicateur ≈ 1.06–1.18.
 */
function chainBoost(ctx: BrainContext, id: string): number {
  const prev = ctx.memory.lastBehavior();
  if (!prev) return 1;

  const table: Record<string, Partial<Record<string, number>>> = {
    think: { work: 1.22, study: 1.18 },
    work: { coffee: 1.12, yawn: 1.12, think: 1.12, idle: 1.08 },
    look: { perch: 1.16, window: 1.16 },
    dance: { idle: 1.12, look: 1.1, walk: 1.08 },
    eat: { idle: 1.12, walk: 1.1 },
    yawn: { sleep: 1.15, idle: 1.08, work: 1.06, coffee: 1.1 },
    happy: { look: 1.14, think: 1.12, idle: 1.1, walk: 1.08 },
    excited: { idle: 1.1, look: 1.1, dance: 1.06 },
    coffee: { idle: 1.1, think: 1.06 },
    sleep: { idle: 1.08 },
    angry: { idle: 1.1, look: 1.06 },
  };
  return table[prev]?.[id] ?? 1;
}

/**
 * Pénalité soft anti-spam émotionnel (happy→happy, …).
 * Jamais un blocage absolu.
 */
function emotionRepeatPenalty(ctx: BrainContext, id: string): number {
  const emos = new Set(["happy", "excited", "blow_kiss", "angry", "crying"]);
  if (!emos.has(id)) return 1;
  if (ctx.memory.recentlyDid(id, 2)) return 0.72;
  return 1;
}

/**
 * Pénalité soft si on recrée une oscillation récente (walk↔look, idle↔look, …).
 * Jamais un blocage absolu.
 */
function oscillationPenalty(ctx: BrainContext, id: string): number {
  const chain = ctx.memory.recentChain(2);
  if (chain.length < 2) return 1;
  const a = chain[0]!;
  const b = chain[1]!;
  // Pattern a→b et on re-évalue a
  if (a !== id || b === id) return 1;

  const oscillating =
    (a === "walk" && b === "look") ||
    (a === "look" && b === "walk") ||
    (a === "idle" && b === "look") ||
    (a === "look" && b === "idle") ||
    (a === "idle" && b === "walk") ||
    (a === "walk" && b === "idle") ||
    (a === "look" && b === "think") ||
    (a === "think" && b === "look");

  return oscillating ? 0.65 : 1;
}

/** final = base × novelty × chain × oscillation × emotionRepeat × contextModifier */
function ctxScore(ctx: BrainContext, id: string, base: number): number {
  if (base <= 0) return 0;
  const scored =
    base *
    novelty(ctx, id) *
    chainBoost(ctx, id) *
    oscillationPenalty(ctx, id) *
    emotionRepeatPenalty(ctx, id);
  return withUserContext(scored, userActivityFactor(id, ctx));
}

function withUserReason(base: string, ctx: BrainContext, id?: string): string {
  const nov = id ? ` novelty=${ctx.memory.noveltyLabel(id)}` : "";
  const prev = ctx.memory.lastBehavior();
  const chainBit =
    id && prev && chainBoost(ctx, id) > 1.01 ? ` chainBoost=${prev}→${id}` : "";
  const osc =
    id && oscillationPenalty(ctx, id) < 0.99 ? ` oscPenalty` : "";
  const pers =
    id && ctx.memory.personalityHint(id)
      ? ` personality=${ctx.memory.personalityHint(id)}`
      : "";
  return `${base}${nov}${chainBit}${osc}${pers} ${userHint(ctx)}`;
}

/** Facteur soft selon idleSeconds — pas de timer d'animation. */
function idleScale(ctx: BrainContext, kind: "calm" | "explore" | "move" | "play"): number {
  const t = ctx.idleSeconds;
  if (kind === "calm") {
    if (t < 2) return 1.12;
    if (t > 15) return 0.88;
    return 1;
  }
  if (kind === "move") {
    if (t >= 6 && t < 15) return 1.1;
    if (t >= 15) return 1.06;
    return 1;
  }
  if (kind === "explore") {
    if (t >= 15 && t < 25) return 1.12;
    if (t >= 25) return 1.08;
    if (t >= 6) return 1.05;
    return 1;
  }
  // play (dance)
  if (t >= 25) return 1.14;
  if (t >= 18) return 1.08;
  return 1;
}

/** Gates de chaîne — revalidés au moment d'activer l'étape. */
const gates = {
  stillTired: (ctx: BrainContext) => ctx.needs.tired || ctx.needs.fatigue >= 55,
  wantsCoffee: (ctx: BrainContext) =>
    (ctx.needs.tired || ctx.needs.fatigue >= 50 || ctx.needs.energy <= 45) &&
    ready(ctx, "coffee"),
  windowStillNear: (ctx: BrainContext) => {
    const dx = windowHorizDist(ctx);
    return dx != null && dx < 520;
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

function mealBand(hour: number): boolean {
  // Fenêtres de repas réalistes (pas toute l'après-midi).
  return (
    (hour >= 7 && hour <= 9) ||
    hour === 12 ||
    hour === 13 ||
    (hour >= 19 && hour <= 20)
  );
}

export const idleHere: Consideration = {
  id: "idle",
  priority: 0,
  cooldownMs: 14_000,
  reason: (ctx) =>
    withUserReason(
      `calm pause boredom=${ctx.needs.boredom.toFixed(0)} idle=${ctx.idleSeconds.toFixed(1)}s`,
      ctx,
      "idle",
    ),
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const calm = (100 - ctx.needs.boredom) / 100;
    // Court idle → pause calme ; idle long → moins collant (laisse explore/play).
    let base = ctx.idleSeconds < 2 ? 0.32 : 0.18 + calm * 0.28;
    base *= idleScale(ctx, "calm");
    return ctxScore(ctx, this.id, base);
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
  cooldownMs: 26_000,
  reason: (ctx) =>
    withUserReason(
      `boredom=${ctx.needs.boredom.toFixed(0)} idle=${ctx.idleSeconds.toFixed(1)}s explore`,
      ctx,
      "walk",
    ),
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const restlessness = n01(ctx.needs.boredom);
    const settled = ctx.idleSeconds > 10 ? 0.14 : ctx.idleSeconds > 6 ? 0.07 : 0;
    let base = 0.06 + restlessness * 0.48 + settled;
    if (ctx.needs.boredom < 35) base *= 0.7;
    base *= idleScale(ctx, "move");
    const dx = windowHorizDist(ctx);
    if (
      dx != null &&
      dx < 450 &&
      (ctx.needs.curiosity >= 45 || ctx.needs.boredom >= 50)
    ) {
      if (dx < 220) base *= 0.52;
      else if (dx < 350) base *= 0.72;
      else base *= 0.88;
    }
    return ctxScore(ctx, this.id, base);
  },
  onComplete: { boredom: -8, curiosity: 4 },
  buildGoal(ctx) {
    const floors = ctx.world.points.filter((p) => p.kind === "floor" || p.kind === "corner");
    const pick = floors[Math.floor(Math.random() * Math.max(1, floors.length))];
    const x = pick?.x ?? ctx.world.width * (0.2 + Math.random() * 0.6);
    const dist = Math.abs(x - ctx.body.x);
    return {
      kind: "goTo",
      x,
      y: ctx.world.height,
      label: "walk",
      timeoutSec: goToTimeoutSec(dist, WALK_SPEED),
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
  reason: (ctx) => {
    const returned = ctx.memory.recentWithin("user_returned", ctx.now, 45_000);
    const idle = ctx.memory.recentWithin("user_became_idle", ctx.now, 60_000);
    const hint = returned ? " user_returned" : idle ? " user_became_idle" : "";
    return withUserReason(
      `curiosity=${ctx.needs.curiosity.toFixed(0)} glance${hint}`,
      ctx,
      "look",
    );
  },
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    let base = 0.1 + n01(ctx.needs.curiosity) * 0.4 + n01(ctx.needs.boredom) * 0.1;
    if (ctx.memory.recentWithin("user_returned", ctx.now, 45_000)) base += 0.08;
    if (ctx.memory.recentWithin("user_became_idle", ctx.now, 60_000)) base += 0.06;
    // idleSeconds : hausse légère — moins forte que perch/window (évite look dominant).
    const t = ctx.idleSeconds;
    if (t >= 6 && t < 15) base *= 1.06;
    else if (t >= 15 && t < 25) base *= 1.05;
    return ctxScore(ctx, this.id, base);
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
    reason: (ctx) => withUserReason(opts.reason(ctx), ctx, opts.id),
    utility(ctx) {
      if (!ready(ctx, opts.id)) return 0;
      return ctxScore(ctx, opts.id, Math.max(0, opts.score(ctx)));
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

/** WORK → YAWN? → COFFEE? — chaque étape revalidée (jamais obligatoire). */
export const work = activity({
  id: "work",
  state: "WORK",
  cooldownMs: 120_000,
  priority: 2,
  reason: (ctx) =>
    `mood=${ctx.needs.mood} fatigue=${ctx.needs.fatigue.toFixed(0)} focus block`,
  score: (ctx) => {
    if (ctx.hour < 9 || ctx.hour > 18) return 0;
    if (ctx.needs.exhausted) return 0;
    if (ctx.needs.energy < 25) return 0;
    return (
      0.2 +
      (ctx.needs.mood === "focused" ? 0.48 : 0.14) +
      n01(ctx.needs.boredom) * 0.22 +
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
  cooldownMs: 140_000,
  priority: 1,
  reason: (ctx) => `curiosity=${ctx.needs.curiosity.toFixed(0)} study`,
  score: (ctx) => {
    if (ctx.hour < 8 || ctx.hour > 22) return 0;
    if (ctx.needs.exhausted) return 0;
    return 0.16 + n01(ctx.needs.curiosity) * 0.48;
  },
  onComplete: { curiosity: -10, boredom: -6 },
});

export const coffee = activity({
  id: "coffee",
  state: "COFFEE",
  cooldownMs: 220_000,
  priority: 3,
  reason: (ctx) =>
    `tired=${ctx.needs.tired} fatigue=${ctx.needs.fatigue.toFixed(0)} energy=${ctx.needs.energy.toFixed(0)} caffeine`,
  score: (ctx) => {
    const fatigued = ctx.needs.tired || ctx.needs.fatigue >= 42 || ctx.needs.energy <= 40;
    if (!fatigued) return 0;
    if (ctx.hour >= 7 && ctx.hour <= 11) {
      return 0.38 + (ctx.needs.tired ? 0.4 : 0.22) + n01(ctx.needs.fatigue) * 0.2;
    }
    if (ctx.needs.tired || ctx.needs.fatigue >= 55) {
      return 0.34 + n01(ctx.needs.fatigue) * 0.28;
    }
    return 0.22 + n01(ctx.needs.fatigue) * 0.2;
  },
  onComplete: { energy: 10, fatigue: -12 },
});

export const eat = activity({
  id: "eat",
  state: "EAT",
  cooldownMs: 180_000,
  priority: 2,
  reason: (ctx) =>
    `hour=${ctx.hour} energy=${ctx.needs.energy.toFixed(0)} mealtime`,
  score: (ctx) => {
    if (!mealBand(ctx.hour)) return 0;
    if (ctx.needs.exhausted) return 0;
    const hunger = n01(100 - ctx.needs.energy);
    // Heures de repas + énergie basse/modérée → peut battre walk/look.
    return 0.34 + hunger * 0.42 + (ctx.needs.energy < 55 ? 0.18 : 0.06);
  },
  onComplete: { energy: 12, boredom: -5 },
});

export const think = activity({
  id: "think",
  state: "THINK",
  cooldownMs: 55_000,
  priority: 0,
  reason: (ctx) => `curiosity=${ctx.needs.curiosity.toFixed(0)} ponder`,
  score: (ctx) => {
    let base =
      0.14 + n01(ctx.needs.curiosity) * 0.34 + n01(ctx.needs.boredom) * 0.08;
    // 0–2 s : calme ; 6–12 s : légère hausse (avec look/walk).
    if (ctx.idleSeconds < 2) base *= 1.1;
    else if (ctx.idleSeconds >= 6 && ctx.idleSeconds < 12) base *= 1.06;
    else if (ctx.idleSeconds > 15) base *= 0.9;
    return base;
  },
  onComplete: { curiosity: -4 },
});

export const dance = activity({
  id: "dance",
  state: "DANCE",
  cooldownMs: 280_000,
  priority: 2,
  reason: (ctx) =>
    `boredom=${ctx.needs.boredom.toFixed(0)} energy=${ctx.needs.energy.toFixed(0)} dance`,
  score: (ctx) => {
    if (ctx.needs.boredom < 48) return 0;
    if (ctx.needs.energy < 35) return 0;
    // Cooldown Memory suffit — pas de double-blocage recentlyDid agressif.
    if (ctx.memory.recentlyDid("dance", 2)) return 0;
    const base =
      0.24 +
      n01(ctx.needs.boredom) * 0.7 +
      n01(ctx.needs.energy) * 0.22 +
      (ctx.needs.restless ? 0.12 : 0);
    // Idle prolongé : peut concurrencer le calme — jamais un timer qui force.
    return base * idleScale(ctx, "play");
  },
  onComplete: { boredom: -22, energy: -8, social: 6 },
});

export const sleep = activity({
  id: "sleep",
  state: "SLEEP",
  cooldownMs: 280_000,
  priority: 5,
  reason: (ctx) =>
    `fatigue=${ctx.needs.fatigue.toFixed(0)} energy=${ctx.needs.energy.toFixed(0)} hour=${ctx.hour}`,
  score: (ctx) => {
    if (!ready(ctx, "sleep")) return 0;
    if (ctx.memory.recentlyDid("sleep", 3)) return 0;
    const night = ctx.hour >= 22 || ctx.hour < 7;
    const veryTired = ctx.needs.tired || ctx.needs.exhausted || ctx.needs.fatigue >= 70;
    if (!(veryTired || night)) return 0;
    if (ctx.needs.fatigue < 38 && ctx.needs.energy > 55 && !night) return 0;
    return (
      0.55 +
      (ctx.needs.exhausted ? 0.6 : n01(ctx.needs.fatigue) * 0.5) +
      (1 - n01(ctx.needs.energy)) * 0.3 +
      (night ? 0.25 : 0)
    );
  },
  onComplete: { energy: 25, fatigue: -30, boredom: -8 },
});

export const yawn = activity({
  id: "yawn",
  state: "YAWN",
  cooldownMs: 85_000,
  priority: 4,
  reason: (ctx) => `fatigue=${ctx.needs.fatigue.toFixed(0)} tired yawn`,
  score: (ctx) => {
    const late = ctx.hour >= 21 || ctx.hour < 7;
    if (!ctx.needs.tired && ctx.needs.fatigue < 48 && !late) return 0;
    if (ctx.memory.recentlyDid("sleep", 2)) return 0;
    return 0.34 + n01(ctx.needs.fatigue) * 0.45 + (late ? 0.12 : 0);
  },
});

export const perchEdge: Consideration = {
  id: "perch",
  priority: 2,
  cooldownMs: 200_000,
  reason: (ctx) =>
    withUserReason(
      `curiosity=${ctx.needs.curiosity.toFixed(0)} edge=${ctx.world.nearestEdge ? "yes" : "no"}`,
      ctx,
      "perch",
    ),
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (!ctx.world.nearestEdge) return 0;
    if (ctx.needs.curiosity < 35) return 0;
    const edge = ctx.world.nearestEdge;
    const dist = Math.abs(edge.x - ctx.body.x);
    const reach = Math.max(0, 1 - dist / 2400);
    const base =
      (0.14 + n01(ctx.needs.curiosity) * 0.58 + n01(ctx.needs.boredom) * 0.18) *
      (0.4 + 0.6 * reach) *
      idleScale(ctx, "explore");
    return ctxScore(ctx, this.id, base);
  },
  onComplete: { curiosity: -14, boredom: -10 },
  buildGoal(ctx) {
    const anchor = ctx.world.nearestEdge!;
    const targetX = anchor.x;
    const dist = Math.abs(targetX - ctx.body.x);
    return {
      kind: "goTo",
      x: targetX,
      label: "perch",
      timeoutSec: goToTimeoutSec(dist, WALK_SPEED),
      invalidate: (c) => {
        const e = c.world.nearestEdge;
        if (!e) return true;
        return Math.abs(e.x - targetX) > 120;
      },
      then: {
        kind: "perch",
        anchor,
        duration: 5 + Math.random() * 6,
        label: "perch",
        gate: (c) => gates.edgeStillNear(c) && gates.curiosityOk(c) && gates.notInterrupted(c),
      },
    };
  },
};

export const investigateWindow: Consideration = {
  id: "window",
  priority: 3,
  cooldownMs: 90_000,
  reason: (ctx) => {
    const w = ctx.world.nearestWindow;
    return withUserReason(
      `curiosity=${ctx.needs.curiosity.toFixed(0)} window=${w ? "near" : "none"}`,
      ctx,
      "window",
    );
  },
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    const w = ctx.world.nearestWindow;
    if (!w) return 0;
    if (ctx.needs.curiosity < 40 && ctx.needs.boredom < 45) return 0;
    const dist = windowHorizDist(ctx);
    if (dist == null || dist > 700) return 0;
    const proximity = Math.max(0, 1 - dist / 700);
    const interest =
      0.45 + n01(ctx.needs.curiosity) * 0.65 + n01(ctx.needs.boredom) * 0.45;
    const spatial = 0.22 + 1.45 * proximity * proximity;
    return ctxScore(
      ctx,
      this.id,
      interest * spatial * idleScale(ctx, "explore"),
    );
  },
  onComplete: { curiosity: -12, boredom: -8 },
  buildGoal(ctx) {
    const w = ctx.world.nearestWindow!;
    const side = ctx.body.x < w.x + w.width / 2 ? w.x + 24 : w.x + w.width - 24;
    // Contexte : plus curieuse → PUSH ; plus enjouée → PULL (pas 50/50 forcé).
    const pushBias =
      0.35 + n01(ctx.needs.curiosity) * 0.35 - n01(ctx.needs.boredom) * 0.15;
    const mime: StateId = Math.random() < pushBias ? "PUSH" : "PULL";
    const dist = Math.abs(side - ctx.body.x);
    return {
      kind: "goTo",
      x: side,
      label: "window",
      timeoutSec: goToTimeoutSec(dist, WALK_SPEED),
      invalidate: (c) => {
        const nw = c.world.nearestWindow;
        if (!nw) return true;
        const sideNow = c.body.x < nw.x + nw.width / 2 ? nw.x + 24 : nw.x + nw.width - 24;
        return Math.abs(sideNow - side) > 160;
      },
      then: {
        kind: "activity",
        state: mime,
        label: "window",
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
  cooldownMs: 70_000,
  reason: (ctx) => {
    const headY = ctx.body.y - 80;
    const dist = Math.round(ctx.cursor.distanceTo(ctx.body.x, headY));
    const moving = ctx.cursor.moving ? "moving" : "still";
    return withUserReason(
      `cursorNearby + ${moving} + curiosity=${ctx.needs.curiosity.toFixed(0)} social=${ctx.needs.social.toFixed(0)} dist=${dist}`,
      ctx,
      "cursor",
    );
  },
  utility(ctx) {
    if (!ready(ctx, this.id)) return 0;
    if (BUSY_FOR_CURSOR.has(ctx.stateId)) return 0;
    const headY = ctx.body.y - 80;
    const dist = ctx.cursor.distanceTo(ctx.body.x, headY);
    if (dist > 380) return 0;
    const social = n01(ctx.needs.social);
    const curious = n01(ctx.needs.curiosity);
    const proximity = Math.max(0, 1 - dist / 380);
    // Pas de rejet aléatoire — rareté via score + cooldown + contexte focus.
    const base = !ctx.cursor.moving
      ? 0.08 + social * 0.12
      : (0.16 + curious * 0.38 + social * 0.24) * proximity * proximity;
    return ctxScore(ctx, this.id, base);
  },
  buildGoal(ctx) {
    const headY = ctx.body.y - 80;
    const dist = ctx.cursor.distanceTo(ctx.body.x, headY);
    // Chase déterministe : curieuse + curseur mobile + vraiment proche.
    const chase = ctx.needs.curious && ctx.cursor.moving && dist < 220;
    return {
      kind: "reactCursor",
      mode: chase ? "chase" : "notice",
      label: chase ? "cursor-chase" : "cursor-notice",
    };
  },
};

/** Frustration après interruption d'activité ou affection basse + ennui. */
export const angry = activity({
  id: "angry",
  state: "ANGRY",
  cooldownMs: 200_000,
  priority: 2,
  reason: (ctx) => {
    const cause = ctx.memory.recentlyDid("interrupted", 5)
      ? "interrupted"
      : "lowAffection";
    return `frustration ${cause} affection=${ctx.needs.affection.toFixed(0)} boredom=${ctx.needs.boredom.toFixed(0)} frMemory=${ctx.memory.recentFrustration.toFixed(2)}`;
  },
  score: (ctx) => {
    const interrupted = ctx.memory.recentlyDid("interrupted", 5);
    const neglected = ctx.needs.affection < 28 && ctx.needs.boredom >= 55;
    if (!interrupted && !neglected) return 0;
    let base = interrupted
      ? 0.42 + (1 - n01(ctx.needs.affection)) * 0.28 + n01(ctx.needs.boredom) * 0.15
      : 0.28 + (1 - n01(ctx.needs.affection)) * 0.35 + n01(ctx.needs.boredom) * 0.2;
    base += ctx.memory.recentFrustration * 0.18;
    return base;
  },
  onComplete: { boredom: -6, affection: -2 },
});

/** Excitation quand playful + curieuse + assez d'énergie. */
export const excited = activity({
  id: "excited",
  state: "EXCITED",
  cooldownMs: 220_000,
  priority: 1,
  reason: (ctx) => {
    const poke = ctx.memory.recentWithin("poke", ctx.now, 30_000) ? " recentPoke" : "";
    return `playful excitement energy=${ctx.needs.energy.toFixed(0)} curiosity=${ctx.needs.curiosity.toFixed(0)} boredom=${ctx.needs.boredom.toFixed(0)}${poke}`;
  },
  score: (ctx) => {
    if (ctx.needs.mood !== "playful") return 0;
    if (ctx.needs.curiosity < 55) return 0;
    if (ctx.needs.energy < 50) return 0;
    if (ctx.needs.exhausted) return 0;
    let base =
      0.3 +
      n01(ctx.needs.energy) * 0.22 +
      n01(ctx.needs.curiosity) * 0.28 +
      n01(ctx.needs.boredom) * 0.12;
    if (ctx.memory.recentWithin("poke", ctx.now, 30_000)) base += 0.1;
    base += ctx.memory.recentPositiveInteraction * 0.08;
    return base;
  },
  onComplete: { boredom: -10, curiosity: -6, social: 4 },
});

/** Détresse rare : épuisement + affection basse, ou interruption alors que tired. */
export const crying = activity({
  id: "crying",
  state: "CRYING",
  cooldownMs: 320_000,
  priority: 3,
  reason: (ctx) => {
    const cause =
      ctx.needs.exhausted && ctx.needs.affection < 35
        ? "exhausted"
        : "interrupted";
    return `distressed ${cause} affection=${ctx.needs.affection.toFixed(0)} fatigue=${ctx.needs.fatigue.toFixed(0)}`;
  },
  score: (ctx) => {
    const burnout = ctx.needs.exhausted && ctx.needs.affection < 35;
    const hurt =
      ctx.needs.tired &&
      ctx.memory.recentlyDid("interrupted", 4) &&
      ctx.needs.affection < 40;
    if (!burnout && !hurt) return 0;
    return (
      0.48 +
      (ctx.needs.exhausted ? 0.35 : 0.18) +
      (1 - n01(ctx.needs.affection)) * 0.25
    );
  },
  onComplete: { affection: 4, boredom: -4 },
});

/** Bisou résiduel après interaction affective récente. */
export const blowKiss = activity({
  id: "blow_kiss",
  state: "BLOW_KISS",
  cooldownMs: 240_000,
  priority: 1,
  reason: (ctx) =>
    `affectionate kiss affection=${ctx.needs.affection.toFixed(0)} social=${ctx.needs.social.toFixed(0)} positiveMemory=${ctx.memory.recentPositiveInteraction.toFixed(2)}`,
  score: (ctx) => {
    if (ctx.needs.affection < 75) return 0;
    if (ctx.needs.social < 55) return 0;
    const recent =
      ctx.memory.recentlyDid("pet", 4) ||
      ctx.memory.recentlyDid("wave", 4) ||
      ctx.memory.recentlyDid("happy", 4) ||
      ctx.memory.recentlyDid("love", 4);
    if (!recent) return 0;
    if (ctx.memory.recentlyDid("blow_kiss", 2)) return 0;
    return (
      0.34 +
      n01(ctx.needs.affection) * 0.3 +
      n01(ctx.needs.social) * 0.22 +
      ctx.memory.recentPositiveInteraction * 0.12
    );
  },
  onComplete: { affection: 3, social: 5, boredom: -4 },
});

/** Joie résiduelle après pet/wave/kiss. */
export const happy = activity({
  id: "happy",
  state: "HAPPY",
  cooldownMs: 160_000,
  priority: 0,
  reason: (ctx) => {
    const pet = ctx.memory.recentWithin("pet", ctx.now, 40_000);
    const returned = ctx.memory.recentWithin("user_returned", ctx.now, 45_000);
    const tag = pet ? "recentPet" : returned ? "user_returned" : "recentSocial";
    return `${tag} + affection=${ctx.needs.affection.toFixed(0)} social=${ctx.needs.social.toFixed(0)} positiveMemory=${ctx.memory.recentPositiveInteraction.toFixed(2)}`;
  },
  score: (ctx) => {
    if (ctx.needs.affection < 55) return 0;
    // Anti-spam : pas de happy→happy immédiat.
    if (ctx.memory.recentlyDid("happy", 2)) return 0;
    const recent =
      ctx.memory.recentWithin("pet", ctx.now, 40_000) ||
      ctx.memory.recentWithin("wave", ctx.now, 40_000) ||
      ctx.memory.recentWithin("blow_kiss", ctx.now, 40_000) ||
      ctx.memory.recentWithin("love", ctx.now, 40_000) ||
      ctx.memory.recentWithin("user_returned", ctx.now, 45_000);
    if (!recent) return 0;
    return (
      0.26 +
      n01(ctx.needs.affection) * 0.28 +
      n01(ctx.needs.social) * 0.12 +
      ctx.memory.recentPositiveInteraction * 0.2
    );
  },
  onComplete: { boredom: -5, social: 3 },
});

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
  angry,
  excited,
  crying,
  blowKiss,
  happy,
];
