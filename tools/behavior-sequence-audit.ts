/**
 * Phase 4 Étape A — Audit des séquences comportementales (observation seule).
 * Aucune modification d'utilities / Memory / catalog / Brain.
 *
 * Usage: npx --yes tsx tools/behavior-sequence-audit.ts
 */

import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { emptyEnvironment } from "../src/environment/EnvironmentContext";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { goToTimeoutSec, type Goal } from "../src/behavior/Goal";
import { WALK_SPEED } from "../src/motion/Locomotion";
import { ANIMATION_IDS } from "../src/assets/generated/animations";

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
  edge_peek: "explore",
  edge_stop: "calm",
  edge_step_back: "locomotion",
  environment_inspect: "explore",
  confused_environment: "calm",
  environment_surprise: "emotion",
  look_up: "calm",
  look_down: "calm",
  look_over_shoulder: "calm",
  phone_check: "social",
  phone_text: "social",
  phone_call: "social",
  computer_type: "focus",
  computer_think: "calm",
  computer_check: "focus",
};

const NATURAL_CHAINS = [
  "work→yawn",
  "yawn→sleep",
  "yawn→coffee",
  "look→perch",
  "look→window",
  "dance→idle",
  "perch→idle",
  "window→idle",
  "eat→idle",
  "eat→walk",
  "coffee→idle",
  "sleep→idle",
  "think→work",
  "think→study",
];

const PROBLEM_PATTERNS = [
  "idle→idle",
  "walk→walk",
  "look→look",
  "idle→walk→idle",
  "walk→look→walk",
  "idle→look→idle",
  "work→idle→work",
  "look→walk→look",
];

interface DecisionRecord {
  id: string;
  family: Family;
  now: number;
  profile: string;
  context: string;
  previous: string | null;
  next: string | null;
  durationSec: number;
  intervalSec: number;
}

function worldBase(opts: {
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  windowDist?: number;
  edgeOffset?: number;
}): WorldSnapshot {
  const bodyX = opts.bodyX ?? 600;
  const wd = opts.windowDist ?? 120;
  return {
    originX: 0,
    originY: 0,
    width: 1400,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [],
    points: [
      { kind: "floor", x: 300, y: 900 },
      { kind: "floor", x: 700, y: 900 },
    ],
    nearestWindow: opts.window
      ? {
          id: 1,
          title: "App",
          x: bodyX + wd - 180,
          y: 120,
          width: 360,
          height: 280,
        }
      : null,
    nearestEdge: opts.edge
      ? {
          x: bodyX + (opts.edgeOffset ?? 40),
          y: 180,
          facing: 1 as const,
          kind: "screen",
        }
      : null,
  } as WorldSnapshot;
}

function makeNeeds(p: Partial<Needs>): Needs {
  const n = new Needs();
  Object.assign(n, p);
  return n;
}

function ctxOf(opts: {
  needs: Needs;
  memory?: Memory;
  now?: number;
  hour?: number;
  idleSeconds?: number;
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  windowDist?: number;
  edgeOffset?: number;
  cursorNear?: boolean;
  cursorMoving?: boolean;
  user?: ReturnType<typeof makeTestSnapshot>;
}): BrainContext {
  const bodyX = opts.bodyX ?? 600;
  const world = worldBase(opts);
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
    now: opts.now ?? 1_000_000,
    body: { x: bodyX, y: 900 } as Body,
    cursor: {
      x: cursorX,
      y: cursorY,
      moving: opts.cursorMoving ?? false,
      idleSeconds: opts.cursorMoving ? 0 : 30,
      vx: opts.cursorMoving ? 40 : 0,
      vy: 0,
      distanceTo: (x: number, y: number) => Math.hypot(cursorX - x, cursorY - y),
    } as CursorTracker,
    needs: opts.needs,
    memory: opts.memory ?? new Memory(),
    world,
    userActivity: user,
    environment: emptyEnvironment(),
    interpretedContext: interpretRules(user),
    stateId: "IDLE",
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

function familyOf(id: string): Family {
  return FAMILY[id] ?? "unknown";
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
  if (goal.kind === "fall") return 2;
  return 6;
}

function clipsForPick(id: string, goal: Goal): string[] {
  switch (id) {
    case "idle":
      return ["idle"];
    case "walk":
      return ["walk"];
    case "look":
      return ["look_around"];
    case "think":
      return ["think"];
    case "work":
      return ["work", "work_alt"];
    case "study":
      return ["study"];
    case "coffee":
      return ["coffee"];
    case "eat":
      return ["eat"];
    case "dance":
      return ["dance1", "dance2", "dance3", "dance4", "dance5", "dance6"];
    case "sleep":
      return ["sleep"];
    case "yawn":
      return ["yawn"];
    case "perch":
      return ["walk", "hang"];
    case "window":
      if (goal.kind === "goTo" && goal.then?.kind === "activity") {
        const st = goal.then.state;
        if (st === "PUSH") return ["walk", "push"];
        if (st === "PULL") return ["walk", "pull"];
      }
      return ["walk", "push", "pull"];
    case "cursor":
      if (goal.kind === "reactCursor" && goal.mode === "chase") {
        return ["chase", "run", "happy"];
      }
      return ["surprise"];
    case "angry":
      return ["angry"];
    case "excited":
      return ["excited"];
    case "crying":
      return ["crying"];
    case "blow_kiss":
      return ["blow_kiss"];
    case "happy":
      return ["happy"];
    default:
      return [];
  }
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
  if (pickId === "yawn" || pickId === "coffee") {
    needs.fatigue = Math.max(0, needs.fatigue - 5);
  }
}

type Profile = {
  name: string;
  n: number;
  build: (i: number) => BrainContext;
  seedMemory?: (mem: Memory, now: number) => void;
};

const TARGET_PICKS = 5000;

function buildProfiles(): Profile[] {
  const n = Math.floor(TARGET_PICKS / 9);
  const rest = TARGET_PICKS - n * 9;
  return [
    {
      name: "inactif",
      n: n + rest,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 80, fatigue: 15, boredom: 35, curiosity: 50 }),
          idleSeconds: 8,
          user: makeTestSnapshot({
            userIdle: true,
            userBusy: false,
            secondsSinceLastInput: 300,
            overallActivity: 0.05,
          }),
        }),
    },
    {
      name: "ennui",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 80, curiosity: 55 }),
          idleSeconds: 18,
        }),
    },
    {
      name: "fatigue",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 25, fatigue: 75, boredom: 30, curiosity: 40 }),
          hour: 22,
          idleSeconds: 6,
        }),
    },
    {
      name: "coding_focused",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 55, fatigue: 45, boredom: 40, curiosity: 45 }),
          hour: 11,
          idleSeconds: 5,
          user: makeTestSnapshot({
            category: "coding",
            userBusy: true,
            userIdle: false,
            overallActivity: 0.85,
            activeAppDurationSec: 40 * 60,
            secondsSinceLastInput: 2,
          }),
        }),
    },
    {
      name: "idle_away",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 75, fatigue: 18, boredom: 55, curiosity: 65 }),
          idleSeconds: 22,
          user: makeTestSnapshot({
            userIdle: true,
            userBusy: false,
            secondsSinceLastInput: 600,
            overallActivity: 0,
            category: "browser",
          }),
        }),
    },
    {
      name: "repas",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 42, fatigue: 30, boredom: 35, curiosity: 50 }),
          hour: 12,
          idleSeconds: 7,
        }),
    },
    {
      name: "fenetre_proche",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 75 }),
          window: true,
          windowDist: 100,
          idleSeconds: 12,
        }),
    },
    {
      name: "bord_proche",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 50, curiosity: 80 }),
          edge: true,
          edgeOffset: 40,
          idleSeconds: 12,
        }),
    },
    {
      name: "interactions_user",
      n,
      build: () =>
        ctxOf({
          needs: makeNeeds({
            energy: 70,
            fatigue: 15,
            boredom: 40,
            curiosity: 55,
            affection: 70,
            social: 60,
          }),
          idleSeconds: 5,
          cursorNear: true,
          cursorMoving: true,
        }),
      seedMemory: (mem, now) => {
        if (Math.random() < 0.35) mem.remember("pet", now);
        if (Math.random() < 0.15) mem.remember("user_returned", now, 45_000);
        if (Math.random() < 0.1) mem.remember("interrupted", now);
      },
    },
  ];
}

function pct(n: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((100 * n) / total).toFixed(1)}%`;
}

function shannonNormalized(counts: Record<string, number>): number {
  const values = Object.values(counts).filter((v) => v > 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || values.length <= 1) return 0;
  let h = 0;
  for (const v of values) {
    const p = v / total;
    h -= p * Math.log2(p);
  }
  const hMax = Math.log2(values.length);
  return hMax > 0 ? h / hMax : 0;
}

function countPattern(seq: string[], pattern: string[]): number {
  let n = 0;
  for (let i = 0; i <= seq.length - pattern.length; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (seq[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) n++;
  }
  return n;
}

function fail(msg: string): never {
  console.error(`SELF-CHECK FAIL: ${msg}`);
  process.exit(1);
}

const profiles = buildProfiles();
const mem = new Memory();
const records: DecisionRecord[] = [];
const considerationCounts: Record<string, number> = {};
const familyCounts: Record<string, number> = {};
const clipSeen = new Set<string>();
const transitionCounts: Record<string, number> = {};
const familyTransitionCounts: Record<string, number> = {};
const intervalsById: Record<string, number[]> = {};
const durations: number[] = [];
const goToDurations: number[] = [];
const intervals: number[] = [];
const lastSeenAt = new Map<string, number>();
const repeatGaps: number[] = [];

let now = 1_000_000;
let previous: string | null = null;
let previousFamily: Family | null = null;

for (const profile of profiles) {
  for (let i = 0; i < profile.n; i++) {
    const ctx = profile.build(i);
    ctx.memory = mem;
    ctx.now = now;
    profile.seedMemory?.(mem, now);

    const pick = pickOnce(ctx);
    const intervalSec = 12 + Math.random() * 10;

    if (!pick) {
      considerationCounts["(none)"] = (considerationCounts["(none)"] ?? 0) + 1;
      now += intervalSec * 1000;
      continue;
    }

    const fam = familyOf(pick.id);
    const durationSec = estimateDurationSec(pick.goal, ctx.body.x);
    const cons = ALL_CONSIDERATIONS.find((c) => c.id === pick.id)!;
    mem.remember(pick.id, now, cons.cooldownMs ?? 30_000);

    if (previous) {
      const key = `${previous}→${pick.id}`;
      transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;
      if (previousFamily) {
        const fk = `${previousFamily}→${fam}`;
        familyTransitionCounts[fk] = (familyTransitionCounts[fk] ?? 0) + 1;
      }
    }

    const lastAt = lastSeenAt.get(pick.id);
    if (lastAt != null) {
      repeatGaps.push((now - lastAt) / 1000);
    }
    lastSeenAt.set(pick.id, now);

    for (const clip of clipsForPick(pick.id, pick.goal)) clipSeen.add(clip);

    if (pick.goal.kind === "goTo") goToDurations.push(durationSec);
    durations.push(durationSec);
    intervals.push(intervalSec);
    (intervalsById[pick.id] ??= []).push(intervalSec);

    considerationCounts[pick.id] = (considerationCounts[pick.id] ?? 0) + 1;
    familyCounts[fam] = (familyCounts[fam] ?? 0) + 1;

    const rec: DecisionRecord = {
      id: pick.id,
      family: fam,
      now,
      profile: profile.name,
      context: `${ctx.interpretedContext.mode}/${ctx.interpretedContext.disturbanceTolerance}`,
      previous,
      next: null,
      durationSec,
      intervalSec,
    };
    if (records.length > 0) {
      records[records.length - 1]!.next = pick.id;
    }
    records.push(rec);

    driftNeeds(ctx.needs, pick.id);
    previous = pick.id;
    previousFamily = fam;
    now += intervalSec * 1000;
  }
}

const seq = records.map((r) => r.id);
const famSeq = records.map((r) => r.family);
const totalPicks = records.length;

let sameCons = 0;
let sameFam2 = 0;
let sameFam3 = 0;
for (let i = 1; i < seq.length; i++) {
  if (seq[i] === seq[i - 1]) sameCons++;
  if (famSeq[i] === famSeq[i - 1]) sameFam2++;
  if (i >= 2 && famSeq[i] === famSeq[i - 1] && famSeq[i - 1] === famSeq[i - 2]) {
    sameFam3++;
  }
}

const patternHits: Record<string, number> = {};
for (const p of PROBLEM_PATTERNS) {
  patternHits[p] = countPattern(seq, p.split("→"));
}
const naturalHits: Record<string, number> = {};
for (const p of NATURAL_CHAINS) {
  naturalHits[p] = countPattern(seq, p.split("→"));
}

const sortedTrans = Object.entries(transitionCounts).sort((a, b) => b[1] - a[1]);
const sortedCons = Object.entries(considerationCounts)
  .filter(([k]) => k !== "(none)")
  .sort((a, b) => b[1] - a[1]);
const sortedFam = Object.entries(familyCounts).sort((a, b) => b[1] - a[1]);

const over5 = sortedCons.filter(([, v]) => v / totalPicks > 0.05);
const under1 = sortedCons.filter(([, v]) => v / totalPicks < 0.01 && v > 0);
const usedIds = new Set(sortedCons.map(([k]) => k));
const neverCons = ALL_CONSIDERATIONS.map((c) => c.id).filter((id) => !usedIds.has(id));
const neverClips = ANIMATION_IDS.filter((id) => !clipSeen.has(id));

const entropy = shannonNormalized(
  Object.fromEntries(sortedCons.map(([k, v]) => [k, v])),
);

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const transSum = Object.values(transitionCounts).reduce((a, b) => a + b, 0);

if (totalPicks < TARGET_PICKS * 0.85) {
  fail(`trop peu de picks: ${totalPicks} (attendu ~${TARGET_PICKS})`);
}
if (usedIds.size < 5) fail(`trop peu de considerations: ${usedIds.size}`);
if (Object.keys(familyCounts).length < 3) {
  fail(`trop peu de familles: ${Object.keys(familyCounts).length}`);
}
if (sortedTrans.length < 10) fail(`trop peu de transitions: ${sortedTrans.length}`);
const sumCons = Object.values(considerationCounts).reduce((a, b) => a + b, 0);
if (sumCons < totalPicks) {
  fail(`incohérence counts: sum=${sumCons} picks=${totalPicks}`);
}
if (Math.abs(transSum - (totalPicks - 1)) > 2) {
  fail(`transitions=${transSum} attendu ≈ ${totalPicks - 1}`);
}
for (const id of neverCons) {
  const c = ALL_CONSIDERATIONS.find((x) => x.id === id);
  if (!c) fail(`consideration inconnue dans never: ${id}`);
}

console.log("SELF-CHECK OK\n");

console.log("=== BEHAVIOR SEQUENCE AUDIT ===\n");
console.log(`Picks: ${totalPicks}`);
console.log(`Profils: ${profiles.map((p) => `${p.name}(${p.n})`).join(", ")}`);
console.log(`Temps simulé: ${((now - 1_000_000) / 1000 / 60).toFixed(1)} min\n`);

console.log("1. REPETITIONS");
console.log("--------------");
console.log(
  `même consideration consécutive : ${sameCons} (${pct(sameCons, totalPicks - 1)})`,
);
console.log(`même famille ×2 (consécutif)   : ${sameFam2} (${pct(sameFam2, totalPicks - 1)})`);
console.log(`même famille ×3 (consécutif)   : ${sameFam3} (${pct(sameFam3, totalPicks - 2)})`);
console.log(`% répétition immédiate (id)    : ${pct(sameCons, Math.max(1, totalPicks - 1))}`);
console.log("\nMotifs problématiques (comptage):");
for (const p of PROBLEM_PATTERNS) {
  console.log(`  ${p.padEnd(22)} ${patternHits[p]}`);
}
console.log("");

console.log("2. TRANSITIONS");
console.log("--------------");
console.log("Top 20 previous → next:");
for (const [k, v] of sortedTrans.slice(0, 20)) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(5)}  ${pct(v, transSum)}`);
}
console.log("\nTransitions rares (1–2):");
const rare = sortedTrans.filter(([, v]) => v <= 2);
for (const [k, v] of rare.slice(0, 25)) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}
if (rare.length > 25) console.log(`  … +${rare.length - 25} autres`);

const expectedPairs = [
  "idle→walk",
  "walk→idle",
  "walk→look",
  "look→walk",
  "idle→look",
  "look→idle",
  "think→work",
  "work→yawn",
  "dance→idle",
  "eat→walk",
];
const neverTrans = expectedPairs.filter((p) => !transitionCounts[p]);
console.log("\nTransitions attendues jamais observées:");
if (neverTrans.length === 0) console.log("  (aucune parmi la liste de référence)");
else for (const p of neverTrans) console.log(`  ${p}`);
console.log("");

console.log("3. DIVERSITY");
console.log("------------");
console.log(`Considerations utilisées : ${usedIds.size} / ${ALL_CONSIDERATIONS.length}`);
console.log(`Clips touchés (approx)   : ${clipSeen.size} / ${ANIMATION_IDS.length}`);
console.log(`Entropie Shannon norm.   : ${(100 * entropy).toFixed(1)}%`);
console.log("\nDistribution considerations:");
for (const [k, v] of sortedCons) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}  ${pct(v, totalPicks)}`);
}
console.log(`\n>5%: ${over5.map(([k]) => k).join(", ") || "—"}`);
console.log(`<1% (mais >0): ${under1.map(([k]) => k).join(", ") || "—"}`);
console.log(`Jamais (considerations): ${neverCons.join(", ") || "—"}`);
console.log(`Jamais (clips approx): ${neverClips.join(", ") || "—"}`);
console.log("");

console.log(
  `DIVERSITÉ
---------
Considerations utilisées : ${usedIds.size} / ${ALL_CONSIDERATIONS.length}
Clips utilisés            : ${clipSeen.size} / ${ANIMATION_IDS.length}
>5%                       : ${over5.map(([k, v]) => `${k}(${pct(v, totalPicks)})`).join(", ") || "—"}
<1%                       : ${under1.map(([k]) => k).join(", ") || "—"}
Jamais                    : ${neverCons.join(", ") || "—"}
Entropie                  : ${(100 * entropy).toFixed(1)}%

Famille dominante         : ${sortedFam[0]?.[0] ?? "—"} (${pct(sortedFam[0]?.[1] ?? 0, totalPicks)})
`,
);

console.log("4. FAMILIES");
console.log("-----------");
for (const [k, v] of sortedFam) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}  ${pct(v, totalPicks)}`);
}
console.log("\nTop transitions de familles:");
for (const [k, v] of Object.entries(familyTransitionCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)) {
  console.log(`  ${k.padEnd(24)} ${v}`);
}
console.log("");

console.log("5. DURATIONS");
console.log("------------");
console.log(`durée moyenne comportement (goal) : ${avg(durations).toFixed(1)}s`);
console.log(
  `durée moyenne goTo                : ${avg(goToDurations).toFixed(1)}s (n=${goToDurations.length})`,
);
console.log(`intervalle moyen entre décisions  : ${avg(intervals).toFixed(1)}s`);
console.log(
  `temps moyen avant re-pick même id : ${avg(repeatGaps).toFixed(1)}s (n=${repeatGaps.length})`,
);
console.log("intervalle moyen par considération (top):");
for (const [k] of sortedCons.slice(0, 8)) {
  const xs = intervalsById[k] ?? [];
  console.log(`  ${k.padEnd(14)} ${avg(xs).toFixed(1)}s`);
}
console.log("");

console.log("6. DOMINANT LOOPS");
console.log("-----------------");
const dominant = PROBLEM_PATTERNS.map((p) => ({ p, n: patternHits[p] ?? 0 }))
  .filter((x) => x.n > 0)
  .sort((a, b) => b.n - a.n);
if (dominant.length === 0) console.log("  (aucun motif problématique compté)");
for (const { p, n } of dominant) {
  const share = pct(n, Math.max(1, totalPicks - 2));
  console.log(`  ${p.padEnd(22)} ${String(n).padStart(5)}  (~${share} des fenêtres)`);
}
console.log("");

console.log("7. NATURAL CHAINS");
console.log("-----------------");
for (const p of NATURAL_CHAINS) {
  console.log(`  ${p.padEnd(18)} ${naturalHits[p] ?? 0}`);
}
console.log("");

console.log("8. RARE / DEAD BEHAVIORS");
console.log("------------------------");
console.log(`Jamais choisis: ${neverCons.join(", ") || "—"}`);
console.log(`<1%: ${under1.map(([k, v]) => `${k}(${v})`).join(", ") || "—"}`);
console.log(
  `Clips jamais touchés (approx mapping): ${neverClips.join(", ") || "—"}`,
);
console.log("");

console.log("9. CONCLUSION");
console.log("-------------");
console.log("Boucles problématiques (dominantes / artificiellement fréquentes):");
const problemTop = dominant.filter((d) => d.n >= totalPicks * 0.01);
if (problemTop.length === 0) {
  console.log("  (aucune >1% des fenêtres — vérifier quand même idle/walk/look)");
} else {
  for (const { p, n } of problemTop) console.log(`  • ${p} (${n})`);
}

const idleN = considerationCounts["idle"] ?? 0;
const walkN = considerationCounts["walk"] ?? 0;
const lookN = considerationCounts["look"] ?? 0;
const thinkN = considerationCounts["think"] ?? 0;
console.log(
  `\nPart calm/locomotion: idle=${pct(idleN, totalPicks)} ` +
    `walk=${pct(walkN, totalPicks)} ` +
    `look=${pct(lookN, totalPicks)} ` +
    `think=${pct(thinkN, totalPicks)}`,
);
console.log(
  `Somme idle+walk+look+think = ${pct(idleN + walkN + lookN + thinkN, totalPicks)}`,
);

console.log("\nChaînes naturelles observées:");
const natObs = NATURAL_CHAINS.filter((p) => (naturalHits[p] ?? 0) > 0);
if (natObs.length === 0) console.log("  (aucune de la liste de référence)");
else for (const p of natObs) console.log(`  • ${p} (${naturalHits[p]})`);

console.log("\nInterprétation:");
if ((idleN + walkN + lookN) / totalPicks > 0.45) {
  console.log(
    "  → La boucle idle/walk/look domine les utilities (pas seulement des décisions trop rapprochées).",
  );
  console.log(
    `  → Intervalle moyen ~${avg(intervals).toFixed(0)}s; re-pick moyen ~${avg(repeatGaps).toFixed(0)}s — la fréquence vient surtout du scoring.`,
  );
} else {
  console.log("  → idle/walk/look ne monopolisent pas à eux seuls >45%.");
}
console.log(
  "  → Aucune correction appliquée (Étape A). Étape B à décider après ce rapport.",
);
console.log("\n=== END AUDIT ===");
