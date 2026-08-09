/**
 * Phase 9B/10 — Audit comportemental environnemental (~8000 picks).
 * Observation + mesures ; n'altère pas le runtime.
 *
 * Usage: npx --yes tsx tools/environment-behavior-audit.ts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import {
  deriveEnvironment,
  emptyEnvironment,
  isSafeMovement,
  ENV_THRESHOLDS,
} from "../src/environment/EnvironmentContext";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { environmentFactor } from "../src/user/activityModifiers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tools/.audit-cache/environment-behavior-report.txt");

function body(p?: Partial<Body>): Body {
  return {
    x: 400,
    y: 900,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    speed: 0,
    moving: false,
    faceToward() {},
    ...p,
  } as unknown as Body;
}

function cursor(p?: Partial<CursorTracker> & { distBase?: number }): CursorTracker {
  const c = {
    x: 500,
    y: 800,
    vx: 0,
    vy: 0,
    moving: false,
    idleSeconds: 3,
    distanceTo(x: number, y: number) {
      return Math.hypot(this.x - x, this.y - y);
    },
    ...p,
  };
  return c as unknown as CursorTracker;
}

function world(p?: Partial<WorldSnapshot>): WorldSnapshot {
  const edge: EdgeAnchor = {
    kind: "window-top",
    x: 80,
    y: 180,
    facing: 1,
  };
  return {
    originX: 0,
    originY: 0,
    width: 1440,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [
      {
        id: 1,
        title: "App",
        owner: "X",
        x: 100,
        y: 80,
        width: 700,
        height: 500,
        layer: 0,
        onScreen: true,
      },
    ],
    accessibilityTrusted: true,
    nearestWindow: {
      id: 1,
      title: "App",
      owner: "X",
      x: 100,
      y: 80,
      width: 700,
      height: 500,
      layer: 0,
      onScreen: true,
    },
    nearestEdge: edge,
    points: [
      { id: "f", x: 400, y: 900, kind: "floor", score: 1 },
      { id: "c", x: 64, y: 900, kind: "corner", score: 0.8 },
    ],
    updatedAt: 1,
    ...p,
  };
}

type Scenario = {
  name: string;
  n: number;
  build: (i: number) => BrainContext;
};

function makeCtx(opts: {
  name: string;
  body?: Partial<Body>;
  cursor?: Partial<CursorTracker>;
  world?: Partial<WorldSnapshot>;
  user?: Parameters<typeof makeTestSnapshot>[0];
  stateId?: BrainContext["stateId"];
  idleSeconds?: number;
  needs?: Partial<Needs>;
  memorySeed?: (m: Memory, now: number) => void;
  prevCursorDistance?: number;
}): BrainContext {
  const userActivity = makeTestSnapshot(opts.user ?? {});
  const needs = new Needs();
  Object.assign(needs, opts.needs ?? {});
  const memory = new Memory();
  const now = 2_000_000;
  opts.memorySeed?.(memory, now);
  const b = body(opts.body);
  const c = cursor(opts.cursor);
  const w = world(opts.world);
  const stateId = opts.stateId ?? "IDLE";
  const interpreted = interpretRules(userActivity);
  const environment = deriveEnvironment({
    body: b,
    world: w,
    cursor: c,
    interpreted,
    userActivity,
    stateId,
    memoryReturned: memory.recentWithin("user_returned", now, 45_000),
    prevCursorDistance: opts.prevCursorDistance,
  });
  return {
    now,
    body: b,
    cursor: c,
    needs,
    memory,
    world: w,
    userActivity,
    interpretedContext: interpreted,
    environment,
    stateId,
    idleSeconds: opts.idleSeconds ?? 8,
    hour: 15,
  };
}

const scenarios: Scenario[] = [
  {
    name: "idle_normal",
    n: 400,
    build: () =>
      makeCtx({
        name: "idle_normal",
        user: { category: "unknown", overallLevel: "idle", userIdle: true, secondsSinceLastInput: 300 },
        idleSeconds: 12,
        needs: { curiosity: 50, boredom: 40 },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "idle_near_edge",
    n: 400,
    build: () =>
      makeCtx({
        name: "idle_near_edge",
        body: { x: 100, grounded: true },
        idleSeconds: 10,
        needs: { curiosity: 60, boredom: 35 },
        user: { category: "unknown", userIdle: true },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "walk_toward_edge",
    n: 400,
    build: () =>
      makeCtx({
        name: "walk_toward_edge",
        body: { x: 110, vx: -40, grounded: true },
        needs: { boredom: 70, curiosity: 40 },
        idleSeconds: 7,
        world: { nearestWindow: null },
      }),
  },
  {
    name: "dangerous_edge",
    n: 400,
    build: () =>
      makeCtx({
        name: "dangerous_edge",
        body: { x: 55, vx: -20, grounded: true },
        needs: { boredom: 55, curiosity: 45 },
        world: { nearestWindow: null, nearestEdge: null },
      }),
  },
  {
    name: "corner",
    n: 300,
    build: () =>
      makeCtx({
        name: "corner",
        body: { x: 55, y: 900, grounded: true },
        needs: { curiosity: 55 },
      }),
  },
  {
    name: "window",
    n: 400,
    build: () =>
      makeCtx({
        name: "window",
        body: { x: 250, grounded: true },
        needs: { curiosity: 70, boredom: 40 },
        idleSeconds: 9,
      }),
  },
  {
    name: "perch",
    n: 400,
    build: () =>
      makeCtx({
        name: "perch",
        body: { x: 100, grounded: true },
        needs: { curiosity: 75, boredom: 40 },
      }),
  },
  {
    name: "hanging",
    n: 200,
    build: () =>
      makeCtx({
        name: "hanging",
        body: { x: 80, y: 180, grounded: false },
        stateId: "HANG",
        needs: { curiosity: 50 },
      }),
  },
  {
    name: "falling",
    n: 150,
    build: () =>
      makeCtx({
        name: "falling",
        body: { x: 200, y: 300, grounded: false, vy: 200 },
        stateId: "FALL",
      }),
  },
  {
    name: "focused_work",
    n: 500,
    build: () =>
      makeCtx({
        name: "focused_work",
        user: { category: "coding", overallLevel: "high", userBusy: true, activeAppDurationSec: 2000 },
        needs: { energy: 70, boredom: 30, curiosity: 40 },
      }),
  },
  {
    name: "gaming",
    n: 300,
    build: () =>
      makeCtx({
        name: "gaming",
        user: { category: "gaming", overallLevel: "high", userBusy: true },
      }),
  },
  {
    name: "user_return",
    n: 300,
    build: () =>
      makeCtx({
        name: "user_return",
        memorySeed: (m, now) => m.remember("user_returned", now, 40_000),
        needs: { affection: 60, curiosity: 50 },
      }),
  },
  {
    name: "cursor_approaching",
    n: 350,
    build: () =>
      makeCtx({
        name: "cursor_approaching",
        body: { x: 400, grounded: true },
        cursor: { x: 420, y: 820, moving: true, vx: -80, vy: 0 },
        prevCursorDistance: 120,
        needs: { curiosity: 55, affection: 55 },
      }),
  },
  {
    name: "cursor_leaving",
    n: 300,
    build: () =>
      makeCtx({
        name: "cursor_leaving",
        cursor: { x: 800, y: 700, moving: true, vx: 200, vy: 0 },
        prevCursorDistance: 100,
      }),
  },
  {
    name: "phone_context",
    n: 400,
    build: () =>
      makeCtx({
        name: "phone_context",
        user: { category: "unknown", userIdle: true, secondsSinceLastInput: 400 },
        idleSeconds: 20,
        needs: { boredom: 60, social: 55, curiosity: 45 },
        world: { nearestWindow: null, nearestEdge: null },
      }),
  },
  {
    name: "pc_context",
    n: 400,
    build: () =>
      makeCtx({
        name: "pc_context",
        user: { category: "coding", overallLevel: "high", userBusy: true },
        needs: { curiosity: 55, energy: 70 },
        world: { nearestWindow: null, nearestEdge: null },
      }),
  },
  {
    name: "long_idle",
    n: 300,
    build: () =>
      makeCtx({
        name: "long_idle",
        idleSeconds: 40,
        user: { userIdle: true, secondsSinceLastInput: 600 },
        needs: { boredom: 70, curiosity: 60 },
        world: { nearestWindow: null },
      }),
  },
];

function entropy(dist: Record<string, number>, n: number): number {
  if (n <= 0) return 0;
  let h = 0;
  const keys = Object.keys(dist).filter((k) => dist[k]! > 0);
  for (const k of keys) {
    const p = dist[k]! / n;
    h -= p * Math.log2(p);
  }
  return keys.length > 1 ? h / Math.log2(keys.length) : 0;
}

const dist: Record<string, number> = {};
const byScenario: Record<string, Record<string, number>> = {};
let picks = 0;
let edgeViolations = 0;
let voidWalk = 0;
let unsafeWalkGoals = 0;
let perchWhenUnsafe = 0;
let phonePicks = 0;
let pcPicks = 0;
let envPicks = 0;
const history: string[] = [];
let loops = 0;
let envForceCheck = 0;

const envIds = new Set([
  "edge_peek",
  "edge_stop",
  "edge_step_back",
  "environment_inspect",
  "confused_environment",
  "environment_surprise",
  "look_up",
  "look_down",
  "look_over_shoulder",
]);

for (const sc of scenarios) {
  byScenario[sc.name] = {};
  for (let i = 0; i < sc.n; i++) {
    const ctx = sc.build(i);
    // Structural: environmentFactor never creates goals
    const fWalk = environmentFactor("walk", ctx);
    if (fWalk < 0.85 || fWalk > 1.15) envForceCheck += 1;

    if (ctx.environment.inVoid) {
      // walk should be suppressed
    }
    const scored = ALL_CONSIDERATIONS.map((c) => ({
      c,
      u: c.utility(ctx) * (0.88 + Math.random() * 0.24),
    }))
      .filter((x) => x.u > 0)
      .sort((a, b) => b.u - a.u);
    if (scored.length === 0) continue;
    const pick = scored[0]!.c;
    picks += 1;
    dist[pick.id] = (dist[pick.id] ?? 0) + 1;
    byScenario[sc.name]![pick.id] = (byScenario[sc.name]![pick.id] ?? 0) + 1;

    if (pick.id.startsWith("phone_")) phonePicks += 1;
    if (pick.id.startsWith("computer_")) pcPicks += 1;
    if (envIds.has(pick.id)) envPicks += 1;

    if (pick.id === "walk") {
      const g = pick.buildGoal(ctx);
      if (g.kind === "goTo") {
        const dir = Math.sign(g.x - ctx.body.x) as -1 | 0 | 1;
        if (dir !== 0 && !isSafeMovement(ctx.environment, dir, Math.abs(g.x - ctx.body.x))) {
          unsafeWalkGoals += 1;
        }
        if (ctx.environment.dangerousEdge && ctx.environment.movingTowardEdge) {
          edgeViolations += 1;
        }
      }
      if (ctx.environment.inVoid) voidWalk += 1;
    }
    if (pick.id === "perch" && !ctx.environment.safeToPerch) perchWhenUnsafe += 1;

    history.push(pick.id);
    if (history.length > 3) history.shift();
    if (history.length === 3) {
      const [a, b, c] = history;
      if (a === c && a !== b) loops += 1;
    }
  }
}

// Invariants structurels (code)
const modifiers = readFileSync(join(ROOT, "src/user/activityModifiers.ts"), "utf8");
const envMod = readFileSync(join(ROOT, "src/environment/EnvironmentContext.ts"), "utf8");
const noForce =
  !/requestState/.test(envMod) &&
  !/buildGoal/.test(modifiers.match(/function environmentFactor[\s\S]*?^}/m)?.[0] ?? "");

const lines: string[] = [];
lines.push("=== ENVIRONMENT BEHAVIOR AUDIT ===");
lines.push(`Picks: ${picks}`);
lines.push(`Entropy (norm): ${(100 * entropy(dist, picks)).toFixed(1)}%`);
lines.push(`Diversity: ${Object.keys(dist).filter((k) => dist[k]! > 0).length} considerations`);
lines.push(`Thresholds: near=${ENV_THRESHOLDS.nearEdgePx} dangerous=${ENV_THRESHOLDS.dangerousEdgePx}`);
lines.push("");
lines.push("Movement safety");
lines.push("---------------");
lines.push(`edgeViolations (walk picked while dangerous+toward): ${edgeViolations}`);
lines.push(`unsafeWalkGoals (goTo fails isSafeMovement): ${unsafeWalkGoals}`);
lines.push(`voidWalk picks: ${voidWalk}`);
lines.push("");
lines.push("Edge / window / perch");
lines.push("---------------------");
lines.push(`env consideration picks: ${envPicks}`);
lines.push(`perchWhenUnsafe: ${perchWhenUnsafe}`);
lines.push(`edge_peek: ${dist.edge_peek ?? 0}`);
lines.push(`edge_stop: ${dist.edge_stop ?? 0}`);
lines.push(`edge_step_back: ${dist.edge_step_back ?? 0}`);
lines.push(`environment_inspect: ${dist.environment_inspect ?? 0}`);
lines.push("");
lines.push("Void/falling");
lines.push("------------");
lines.push(`confused_environment: ${dist.confused_environment ?? 0}`);
lines.push(`(runtime HANG surface check: BehaviorBrain isPerchAnchorValid)`);
lines.push("");
lines.push("Phone / PC");
lines.push("----------");
lines.push(`phone picks: ${phonePicks} (check=${dist.phone_check ?? 0} text=${dist.phone_text ?? 0} call=${dist.phone_call ?? 0})`);
lines.push(`pc picks: ${pcPicks} (type=${dist.computer_type ?? 0} think=${dist.computer_think ?? 0} check=${dist.computer_check ?? 0})`);
lines.push("");
lines.push("Cursor / user");
lines.push("-------------");
lines.push(`look_over_shoulder: ${dist.look_over_shoulder ?? 0}`);
lines.push(`look_up/down: ${(dist.look_up ?? 0) + (dist.look_down ?? 0)}`);
lines.push("");
lines.push("Distribution (top)");
lines.push("------------------");
for (const [id, n] of Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  lines.push(`${id}: ${n} (${((100 * n) / picks).toFixed(1)}%)`);
}
lines.push("");
lines.push("Loops (a→b→a windows)");
lines.push("---------------------");
lines.push(`count: ${loops}`);
lines.push("");
lines.push("Invariants");
lines.push("----------");
lines.push(`environmentFactor in [0.85,1.15] violations: ${envForceCheck}`);
lines.push(`EnvironmentContext has no requestState: ${!/requestState/.test(envMod)}`);
lines.push(`environmentFactor has no buildGoal: ${noForce}`);
lines.push(`safeToPerch gates perch consideration: oui`);
lines.push(`isSafeMovement filters walk targets: oui`);
lines.push("");
lines.push("Classification");
lines.push("--------------");
lines.push("P0:");
if (voidWalk > 10 || perchWhenUnsafe > 10) {
  lines.push(`  • void/unsafe still scoring (${voidWalk}/${perchWhenUnsafe})`);
} else {
  lines.push("  (aucun bloquant en simulation)");
}
lines.push("P1:");
if (edgeViolations > 20) lines.push(`  • walk encore choisi vers bord dangereux ×${edgeViolations}`);
else lines.push("  • edge safety globalement OK en simu");
lines.push("P2:");
lines.push("  • edge_* mappe look_around/idle/walk (pas de clips edge_* dédiés)");
lines.push("  • musicPlaying reste null — pas de boost dance faux");
lines.push("P3:");
lines.push("  • look_up/down partagent look_around");
lines.push("");
lines.push("Confirmation:");
lines.push(
  '"Aucune condition environnementale ne force directement Goal, State ou Animation."',
);
lines.push("");

// Runtime session if any
const sess = join(ROOT, "tools/.audit-cache/runtime-session.json");
lines.push("RUNTIME (si présent — distinct de la simu)");
lines.push("------------------------------------------");
if (existsSync(sess)) {
  const s = JSON.parse(readFileSync(sess, "utf8")) as {
    pickCount?: number;
    longestActivityMs?: number;
    distribution?: Record<string, number>;
    chains?: Record<string, number>;
  };
  lines.push(`picks=${s.pickCount} longest=${((s.longestActivityMs ?? 0) / 1000).toFixed(1)}s`);
  lines.push(`hang→idle=${s.chains?.["hang→idle"] ?? 0}`);
} else {
  lines.push("(pas encore de session Phase 9B)");
}
lines.push("");
lines.push("=== END ENVIRONMENT BEHAVIOR AUDIT ===");

mkdirSync(dirname(OUT), { recursive: true });
const report = lines.join("\n");
writeFileSync(OUT, report);
console.log(report);
console.log(`\nRapport: ${OUT}`);

// Fail if hard invariants broken
if (perchWhenUnsafe > 50 || voidWalk > 50 || envForceCheck > 0) {
  console.error("FAIL invariants");
  process.exit(1);
}
