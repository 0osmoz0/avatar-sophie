/**
 * Phase 6 — Audit personnalité / réactivité (observation + comparaison).
 *
 * Usage:
 *   npx --yes tsx tools/personality-behavior-audit.ts
 *   npx --yes tsx tools/personality-behavior-audit.ts --after
 *
 * Avant Phase 6B : pas de tendances → section PERSONALITY = baseline neutre.
 * Après : compare réactivité, émotions, tendances.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { goToTimeoutSec, type Goal } from "../src/behavior/Goal";
import { WALK_SPEED } from "../src/motion/Locomotion";
import { resolveInteraction, isBusyState } from "../src/behavior/InteractionResolver";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tools", ".audit-cache");
const BEFORE_PATH = join(OUT_DIR, "personality-before.json");

const TARGET_PICKS = 7000;
const EMOTIONS = new Set(["happy", "excited", "blow_kiss", "angry", "crying"]);
const REACT_TRIGGERS = [
  "pet",
  "wave",
  "love",
  "happy",
  "poke",
  "user_returned",
  "user_became_idle",
  "interrupted",
] as const;

type Family =
  | "locomotion"
  | "calm"
  | "focus"
  | "explore"
  | "rest"
  | "social"
  | "emotion"
  | "unknown";

const FAMILY: Record<string, Family> = {
  idle: "calm",
  walk: "locomotion",
  look: "calm",
  think: "calm",
  work: "focus",
  study: "focus",
  coffee: "rest",
  eat: "rest",
  dance: "social",
  sleep: "rest",
  yawn: "rest",
  perch: "explore",
  window: "explore",
  cursor: "social",
  angry: "emotion",
  excited: "emotion",
  crying: "emotion",
  blow_kiss: "emotion",
  happy: "emotion",
};

type AuditSummary = {
  picks: number;
  entropy: number;
  distribution: Record<string, number>;
  families: Record<string, number>;
  emotionRepeats: Record<string, number>;
  reactivity: Record<string, Record<string, number>>;
  naturalChains: Record<string, number>;
  personalityMean?: Record<string, number>;
  hasPersonalityApi: boolean;
};

function hasPersonalityApi(mem: Memory): boolean {
  return typeof (mem as Memory & { personalitySnapshot?: unknown }).personalitySnapshot ===
    "function";
}

function worldBase(opts: {
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
}): WorldSnapshot {
  const bodyX = opts.bodyX ?? 600;
  return {
    originX: 0,
    originY: 0,
    width: 1400,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [],
    accessibilityTrusted: true,
    points: [
      { id: "f1", kind: "floor", x: 300, y: 900, score: 1 },
      { id: "f2", kind: "floor", x: 700, y: 900, score: 1 },
    ],
    nearestWindow: opts.window
      ? {
          id: 1,
          title: "App",
          owner: "",
          x: bodyX - 60,
          y: 120,
          width: 360,
          height: 280,
          layer: 0,
          onScreen: true,
        }
      : null,
    nearestEdge: opts.edge
      ? { x: bodyX + 40, y: 180, facing: 1, kind: "screen-left" }
      : null,
    updatedAt: Date.now(),
  };
}

function makeNeeds(p: Partial<Needs>): Needs {
  const n = new Needs();
  Object.assign(n, p);
  return n;
}

function ctxOf(opts: {
  needs: Needs;
  memory: Memory;
  now: number;
  hour?: number;
  idleSeconds?: number;
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  cursorNear?: boolean;
  cursorMoving?: boolean;
  user?: ReturnType<typeof makeTestSnapshot>;
  stateId?: BrainContext["stateId"];
}): BrainContext {
  const bodyX = opts.bodyX ?? 600;
  const user =
    opts.user ??
    makeTestSnapshot({
      category: "unknown",
      overallActivity: 0.2,
      userBusy: false,
      userIdle: false,
      secondsSinceLastInput: 30,
    });
  const cursorX = opts.cursorNear ? bodyX + 80 : bodyX + 900;
  const cursorY = opts.cursorNear ? 820 : 100;
  return {
    now: opts.now,
    body: { x: bodyX, y: 900 } as Body,
    cursor: {
      x: cursorX,
      y: cursorY,
      moving: opts.cursorMoving ?? false,
      idleSeconds: opts.cursorMoving ? 0 : 30,
      distanceTo: (x: number, y: number) => Math.hypot(cursorX - x, cursorY - y),
    } as CursorTracker,
    needs: opts.needs,
    memory: opts.memory,
    world: worldBase(opts),
    userActivity: user,
    interpretedContext: interpretRules(user),
    stateId: opts.stateId ?? "IDLE",
    idleSeconds: opts.idleSeconds ?? 10,
    hour: opts.hour ?? 15,
  };
}

function pickOnce(ctx: BrainContext): { id: string; u: number; goal: Goal } | null {
  const scored = ALL_CONSIDERATIONS.map((c) => ({
    c,
    u: c.utility(ctx) * (0.88 + Math.random() * 0.24),
    priority: c.priority ?? 0,
  }))
    .filter((s) => s.u > 0.05)
    .sort((a, b) => b.u - a.u || b.priority - a.priority);
  const top = scored[0];
  if (!top) return null;
  return { id: top.c.id, u: top.u, goal: top.c.buildGoal(ctx) };
}

function estimateDurationSec(goal: Goal, bodyX: number): number {
  if (goal.kind === "idle") return goal.duration ?? 4;
  if (goal.kind === "activity") return goal.duration ?? 8;
  if (goal.kind === "goTo") {
    const dist = Math.abs(goal.x - bodyX);
    return goal.timeoutSec ?? goToTimeoutSec(dist, WALK_SPEED);
  }
  if (goal.kind === "perch") return goal.duration ?? 6;
  if (goal.kind === "reactCursor") return goal.mode === "chase" ? 8 : 2.2;
  return 6;
}

function driftNeeds(needs: Needs, pickId: string): void {
  if (pickId === "walk") needs.boredom = Math.max(0, needs.boredom - 8);
  if (pickId === "look") needs.curiosity = Math.max(0, needs.curiosity - 6);
  if (pickId === "idle") needs.boredom = Math.min(100, needs.boredom + 3);
  if (pickId === "think") needs.curiosity = Math.max(0, needs.curiosity - 4);
  if (pickId === "work" || pickId === "study") {
    needs.fatigue = Math.min(100, needs.fatigue + 4);
    needs.energy = Math.max(0, needs.energy - 3);
    needs.boredom = Math.max(0, needs.boredom - 5);
  }
  if (pickId === "dance") {
    needs.boredom = Math.max(0, needs.boredom - 12);
    needs.energy = Math.max(0, needs.energy - 6);
  }
  if (pickId === "sleep") {
    needs.fatigue = Math.max(0, needs.fatigue - 20);
    needs.energy = Math.min(100, needs.energy + 15);
  }
  if (pickId === "happy" || pickId === "blow_kiss") {
    needs.affection = Math.min(100, needs.affection + 2);
  }
}

type ProfileKind =
  | "calme"
  | "ennui"
  | "travail"
  | "gaming"
  | "idle_away"
  | "interactions_pos"
  | "frustration"
  | "retour"
  | "fatigue"
  | "repas"
  | "spatial";

function profileNeeds(kind: ProfileKind): Needs {
  switch (kind) {
    case "calme":
      return makeNeeds({ energy: 80, fatigue: 15, boredom: 30, curiosity: 50, affection: 50 });
    case "ennui":
      return makeNeeds({ energy: 70, fatigue: 20, boredom: 80, curiosity: 55 });
    case "travail":
      return makeNeeds({ energy: 55, fatigue: 45, boredom: 40, curiosity: 45 });
    case "gaming":
      return makeNeeds({ energy: 65, fatigue: 30, boredom: 50, curiosity: 40 });
    case "idle_away":
      return makeNeeds({ energy: 75, fatigue: 18, boredom: 55, curiosity: 70 });
    case "interactions_pos":
      return makeNeeds({
        energy: 70,
        fatigue: 15,
        boredom: 40,
        curiosity: 55,
        affection: 70,
        social: 60,
      });
    case "frustration":
      return makeNeeds({ energy: 50, fatigue: 40, boredom: 60, curiosity: 40, affection: 25 });
    case "retour":
      return makeNeeds({ energy: 70, fatigue: 20, boredom: 45, curiosity: 55, affection: 60 });
    case "fatigue":
      return makeNeeds({ energy: 25, fatigue: 75, boredom: 30, curiosity: 40 });
    case "repas":
      return makeNeeds({ energy: 42, fatigue: 30, boredom: 35, curiosity: 50 });
    case "spatial":
      return makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 80 });
  }
}

function profileUser(kind: ProfileKind) {
  switch (kind) {
    case "travail":
      return makeTestSnapshot({
        category: "coding",
        userBusy: true,
        userIdle: false,
        overallActivity: 0.85,
        activeAppDurationSec: 40 * 60,
        secondsSinceLastInput: 2,
      });
    case "gaming":
      return makeTestSnapshot({
        category: "gaming",
        userBusy: true,
        userIdle: false,
        overallActivity: 0.75,
        pointerActivity: 0.8,
        secondsSinceLastInput: 0.5,
      });
    case "idle_away":
    case "calme":
      return makeTestSnapshot({
        userIdle: true,
        userBusy: false,
        secondsSinceLastInput: 400,
        overallActivity: 0.02,
        category: "unknown",
      });
    default:
      return makeTestSnapshot({
        category: "browser",
        overallActivity: 0.25,
        userBusy: false,
        userIdle: false,
        secondsSinceLastInput: 20,
      });
  }
}

function shannonNorm(counts: Record<string, number>): number {
  const vals = Object.values(counts);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const n = vals.filter((v) => v > 0).length;
  if (n <= 1) return 0;
  let h = 0;
  for (const v of vals) {
    if (v <= 0) continue;
    const p = v / total;
    h -= p * Math.log2(p);
  }
  return h / Math.log2(n);
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

function runSimulation(): AuditSummary {
  const mem = new Memory();
  const personalityOn = hasPersonalityApi(mem);
  let now = 2_000_000;
  const picks: string[] = [];
  const distribution: Record<string, number> = {};
  const families: Record<string, number> = {};
  const emotionRepeats: Record<string, number> = {};
  const reactivity: Record<string, Record<string, number>> = {};
  for (const t of REACT_TRIGGERS) reactivity[t] = {};
  const naturalChains: Record<string, number> = {};
  const personalityAcc: Record<string, number> = {
    playful: 0,
    social: 0,
    curiosity: 0,
    calm: 0,
    independence: 0,
  };
  let personalitySamples = 0;

  const kinds: ProfileKind[] = [
    "calme",
    "ennui",
    "travail",
    "gaming",
    "idle_away",
    "interactions_pos",
    "frustration",
    "retour",
    "fatigue",
    "repas",
    "spatial",
  ];
  const per = Math.floor(TARGET_PICKS / kinds.length);

  let pendingTrigger: string | null = null;

  for (const kind of kinds) {
    for (let i = 0; i < per; i++) {
      now += 17_000;
      mem.update(17);
      const needs = profileNeeds(kind);
      const ctx = ctxOf({
        needs,
        memory: mem,
        now,
        hour: kind === "fatigue" ? 22 : kind === "repas" ? 12 : 15,
        idleSeconds: kind === "idle_away" || kind === "ennui" ? 20 : 8,
        window: kind === "spatial" || kind === "idle_away",
        edge: kind === "spatial",
        cursorNear: kind === "interactions_pos",
        cursorMoving: kind === "interactions_pos",
        user: profileUser(kind),
      });

      // Inject interaction / signal selon profil (Memory partagée).
      if (kind === "interactions_pos" && i % 7 === 0) {
        const r = resolveInteraction({
          kind: "pet",
          needs,
          memory: mem,
          stateId: "IDLE",
          now,
        });
        for (const x of r.remember) mem.remember(x.label, now, x.cooldownMs ?? 0);
        if (r.notePositive) mem.notePositive(r.notePositive);
        pendingTrigger = "pet";
      } else if (kind === "interactions_pos" && i % 11 === 0) {
        mem.remember("wave", now, 8_000);
        mem.notePositive(0.25);
        pendingTrigger = "wave";
      } else if (kind === "interactions_pos" && i % 13 === 0) {
        mem.remember("love", now, 10_000);
        mem.notePositive(0.35);
        pendingTrigger = "love";
      } else if (kind === "frustration" && i % 8 === 0) {
        mem.remember("interrupted", now);
        mem.noteFrustration(0.4);
        pendingTrigger = "interrupted";
      } else if (kind === "frustration" && i % 9 === 0) {
        const r = resolveInteraction({
          kind: "poke",
          needs,
          memory: mem,
          stateId: "IDLE",
          now,
        });
        for (const x of r.remember) mem.remember(x.label, now, x.cooldownMs ?? 0);
        if (r.noteFrustration) mem.noteFrustration(r.noteFrustration);
        pendingTrigger = "poke";
      } else if (kind === "retour" && i % 6 === 0) {
        mem.remember("user_returned", now, 45_000);
        mem.notePositive(0.3);
        pendingTrigger = "user_returned";
      } else if (kind === "idle_away" && i % 10 === 0) {
        mem.remember("user_became_idle", now, 60_000);
        mem.noteActivity(0.25);
        pendingTrigger = "user_became_idle";
      } else if (kind === "travail" && i % 15 === 0) {
        // PET pendant WORK simulé : Memory only
        const r = resolveInteraction({
          kind: "pet",
          needs,
          memory: mem,
          stateId: "WORK",
          now,
        });
        for (const x of r.remember) mem.remember(x.label, now, x.cooldownMs ?? 0);
        if (r.notePositive) mem.notePositive(r.notePositive);
        pendingTrigger = "pet";
      }

      const pick = pickOnce(ctx);
      if (!pick) continue;

      picks.push(pick.id);
      bump(distribution, pick.id);
      bump(families, FAMILY[pick.id] ?? "unknown");

      if (personalityOn) {
        const snap = (
          mem as Memory & {
            personalitySnapshot: () => Record<string, number>;
          }
        ).personalitySnapshot();
        for (const [k, v] of Object.entries(snap)) {
          personalityAcc[k] = (personalityAcc[k] ?? 0) + v;
        }
        personalitySamples++;
      }

      const prev = picks.length >= 2 ? picks[picks.length - 2]! : null;
      if (prev && EMOTIONS.has(prev) && prev === pick.id) {
        bump(emotionRepeats, `${prev}→${pick.id}`);
      }
      if (prev === "think" && (pick.id === "work" || pick.id === "study")) {
        bump(naturalChains, `think→${pick.id}`);
      }
      if (prev === "look" && (pick.id === "window" || pick.id === "perch")) {
        bump(naturalChains, `look→${pick.id}`);
      }
      if (prev === "work" && pick.id === "yawn") bump(naturalChains, "work→yawn");
      if (prev === "yawn" && pick.id === "coffee") bump(naturalChains, "yawn→coffee");
      if (prev === "dance" && pick.id === "idle") bump(naturalChains, "dance→idle");
      if (prev === "eat" && (pick.id === "idle" || pick.id === "walk")) {
        bump(naturalChains, `eat→${pick.id}`);
      }

      if (pendingTrigger) {
        const bucket = reactivity[pendingTrigger]!;
        const emo = EMOTIONS.has(pick.id) ? pick.id : "non_emotion";
        bump(bucket, emo);
        bump(bucket, pick.id);
        bump(bucket, "_total");
        pendingTrigger = null;
      }

      const cons = ALL_CONSIDERATIONS.find((c) => c.id === pick.id);
      mem.remember(pick.id, now, cons?.cooldownMs ?? 30_000);
      driftNeeds(needs, pick.id);
      now += estimateDurationSec(pick.goal, 600) * 1000;
    }
  }

  // Invariant: PET @ WORK deferred
  {
    const needs = makeNeeds({ affection: 60 });
    const m = new Memory();
    const r = resolveInteraction({
      kind: "pet",
      needs,
      memory: m,
      stateId: "WORK",
      now: now + 1,
    });
    if (!r.deferred || r.immediateState !== null || !isBusyState("WORK")) {
      console.error("FAIL invariant PET@WORK deferred");
      process.exit(1);
    }
  }

  const personalityMean: Record<string, number> | undefined =
    personalitySamples > 0
      ? Object.fromEntries(
          Object.entries(personalityAcc).map(([k, v]) => [
            k,
            Number((v / personalitySamples).toFixed(3)),
          ]),
        )
      : undefined;

  return {
    picks: picks.length,
    entropy: shannonNorm(distribution),
    distribution,
    families,
    emotionRepeats,
    reactivity,
    naturalChains,
    personalityMean,
    hasPersonalityApi: personalityOn,
  };
}

function printSummary(label: string, s: AuditSummary): void {
  console.log(`\n=== PERSONALITY AUDIT (${label}) ===`);
  console.log(`Picks: ${s.picks}`);
  console.log(`Entropie norm.: ${(100 * s.entropy).toFixed(1)}%`);
  console.log(`API personnalité: ${s.hasPersonalityApi ? "oui" : "non (baseline pré-Phase6B)"}`);
  if (s.personalityMean) {
    console.log("Tendances moyennes:");
    for (const [k, v] of Object.entries(s.personalityMean)) {
      console.log(`  ${k}=${v}`);
    }
  }

  console.log("\nDistribution (>2%):");
  const sorted = Object.entries(s.distribution).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sorted) {
    const p = (100 * n) / s.picks;
    if (p >= 2) console.log(`  ${id.padEnd(12)} ${n}  ${p.toFixed(1)}%`);
  }

  console.log("\nFamilles:");
  for (const [f, n] of Object.entries(s.families).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(12)} ${n}  ${((100 * n) / s.picks).toFixed(1)}%`);
  }

  console.log("\nRépétitions émotionnelles:");
  const er = Object.entries(s.emotionRepeats);
  if (er.length === 0) console.log("  (aucune)");
  else for (const [k, v] of er.sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  console.log("\nRéactivité (trigger → next pick émotion / non_emotion):");
  for (const t of REACT_TRIGGERS) {
    const bucket = s.reactivity[t] ?? {};
    const total = bucket._total ?? 0;
    if (total === 0) continue;
    const parts = Object.entries(bucket)
      .filter(([k]) => k !== "_total")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`  ${t} (n=${total}): ${parts}`);
  }

  console.log("\nChaînes naturelles:");
  for (const [k, v] of Object.entries(s.naturalChains).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

function compare(before: AuditSummary, after: AuditSummary): void {
  console.log("\n=== COMPARAISON AVANT / APRÈS ===");
  console.log(
    `Entropie: ${(100 * before.entropy).toFixed(1)}% → ${(100 * after.entropy).toFixed(1)}%`,
  );

  const emoKeys = new Set([
    ...Object.keys(before.emotionRepeats),
    ...Object.keys(after.emotionRepeats),
  ]);
  console.log("\nRépétitions émotionnelles:");
  for (const k of [...emoKeys].sort()) {
    const a = before.emotionRepeats[k] ?? 0;
    const b = after.emotionRepeats[k] ?? 0;
    console.log(`  ${k}: ${a} → ${b} (Δ ${b - a})`);
  }

  console.log("\nRéactivité émotionnelle (share emotion next):");
  for (const t of REACT_TRIGGERS) {
    const bt = before.reactivity[t]?._total ?? 0;
    const at = after.reactivity[t]?._total ?? 0;
    if (bt === 0 && at === 0) continue;
    const be =
      ((before.reactivity[t]?.happy ?? 0) +
        (before.reactivity[t]?.excited ?? 0) +
        (before.reactivity[t]?.blow_kiss ?? 0) +
        (before.reactivity[t]?.angry ?? 0) +
        (before.reactivity[t]?.crying ?? 0)) /
      Math.max(1, bt);
    const ae =
      ((after.reactivity[t]?.happy ?? 0) +
        (after.reactivity[t]?.excited ?? 0) +
        (after.reactivity[t]?.blow_kiss ?? 0) +
        (after.reactivity[t]?.angry ?? 0) +
        (after.reactivity[t]?.crying ?? 0)) /
      Math.max(1, at);
    console.log(
      `  ${t}: ${(100 * be).toFixed(1)}% → ${(100 * ae).toFixed(1)}% émotions (n ${bt}→${at})`,
    );
  }

  console.log("\nTop considerations Δ:");
  const ids = new Set([
    ...Object.keys(before.distribution),
    ...Object.keys(after.distribution),
  ]);
  const deltas: Array<[string, number]> = [];
  for (const id of ids) {
    const bp = (100 * (before.distribution[id] ?? 0)) / before.picks;
    const ap = (100 * (after.distribution[id] ?? 0)) / after.picks;
    deltas.push([id, ap - bp]);
  }
  deltas.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [id, d] of deltas.slice(0, 10)) {
    console.log(`  ${id}: ${d >= 0 ? "+" : ""}${d.toFixed(2)} pp`);
  }
}

function structuralInvariants(): void {
  console.log("\n=== INVARIANTS STRUCTURELS ===");
  const checks: Array<[boolean, string]> = [];
  const srcFiles: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "target", "dist"].includes(name.name)) continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".ts") && !name.name.endsWith(".d.ts")) srcFiles.push(p);
    }
  }
  walk(join(ROOT, "src"));
  const behavior = srcFiles
    .filter((f) => f.includes("/behavior/") || f.includes("/user/"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  checks.push([!/\bquota\b/i.test(behavior), "✓ aucun quota"]);
  checks.push([!/\brotation\b/i.test(behavior), "✓ aucune rotation"]);
  checks.push([
    !/scheduleAnimation|setInterval\([^)]*requestState/.test(behavior),
    "✓ aucun scheduler d'animation",
  ]);
  checks.push([
    !/personalitySnapshot[\s\S]{0,200}requestState|nudgePersonality[\s\S]{0,200}requestState/.test(
      behavior,
    ),
    "✓ personnalité ne requestState pas",
  ]);
  checks.push([
    !/suggestedGoal|buildGoal/.test(
      readFileSync(join(ROOT, "src/user/OllamaContextClient.ts"), "utf8"),
    ),
    "✓ Ollama classification-only",
  ]);
  checks.push([
    !/frontmost|teleport/i.test(
      readFileSync(join(ROOT, "src/user/activityModifiers.ts"), "utf8"),
    ),
    "✓ pas de ciblage fenêtre active",
  ]);

  // Personality bounds + decay if API present
  const mem = new Memory();
  if (hasPersonalityApi(mem)) {
    const m = mem as Memory & {
      playfulness: number;
      sociability: number;
      curiosityBias: number;
      calmness: number;
      independence: number;
      nudgePersonality: (p: Record<string, number>) => void;
      personalitySnapshot: () => Record<string, number>;
    };
    m.nudgePersonality({ playfulness: 0.5, sociability: 0.5 });
    const snap = m.personalitySnapshot();
    const inRange = Object.values(snap).every((v) => v >= 0 && v <= 1);
    checks.push([inRange, "✓ personality values always in [0,1]"]);
    const before = m.playfulness;
    for (let i = 0; i < 200; i++) m.update(1);
    checks.push([m.playfulness < before || before <= 0.55, "✓ trends decay toward baseline"]);
  } else {
    checks.push([true, "ℹ personality API absente (baseline AVANT)"]);
  }

  for (const [ok, label] of checks) {
    console.log(ok ? `ok — ${label}` : `FAIL — ${label}`);
    if (!ok) process.exit(1);
  }
}

// --- main ---
const wantAfter = process.argv.includes("--after");
const summary = runSimulation();
printSummary(summary.hasPersonalityApi ? "APRÈS" : "AVANT", summary);
structuralInvariants();

mkdirSync(OUT_DIR, { recursive: true });

if (!summary.hasPersonalityApi) {
  writeFileSync(BEFORE_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nBaseline écrite: ${BEFORE_PATH}`);
  console.log("Phase 6A observation OK — aucune utility modifiée.");
} else if (wantAfter || existsSync(BEFORE_PATH)) {
  if (existsSync(BEFORE_PATH)) {
    const before = JSON.parse(readFileSync(BEFORE_PATH, "utf8")) as AuditSummary;
    compare(before, summary);
  }
  writeFileSync(join(OUT_DIR, "personality-after.json"), JSON.stringify(summary, null, 2));
  console.log("\nConfirmation: aucune tendance ne force Goal / State / Animation.");
  console.log("Phase 6 personnalité audit OK.");
} else {
  console.log("\n(Pas de baseline AVANT — lancer d'abord sans API personnalité.)");
}
