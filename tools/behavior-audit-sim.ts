/**
 * Audit post-corrections — distribution + taux d'arrivée chaînes spatiales.
 * Usage: npx --yes tsx tools/behavior-audit-sim.ts
 */

import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { goToTimeoutSec, type Goal } from "../src/behavior/Goal";
import { WALK_SPEED } from "../src/motion/Locomotion";

type Counts = Record<string, number>;

function worldBase(opts: {
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  windowDist?: number;
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
      { kind: "corner", x: 50, y: 900 },
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
      ? { x: bodyX + 40, y: 180, facing: 1 as const, kind: "screen" }
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
  user?: ReturnType<typeof makeTestSnapshot>;
}): BrainContext {
  const bodyX = opts.bodyX ?? 600;
  const edgeX = bodyX + (opts.edgeOffset ?? 40);
  const world = worldBase({
    window: opts.window,
    edge: opts.edge,
    bodyX,
    windowDist: opts.windowDist,
  });
  if (opts.edge && world.nearestEdge) {
    (world as { nearestEdge: WorldSnapshot["nearestEdge"] }).nearestEdge = {
      ...world.nearestEdge,
      x: edgeX,
    };
  }
  return {
    now: opts.now ?? 1_000_000,
    body: { x: bodyX, y: 900 } as Body,
    cursor: {
      x: 20,
      y: 100,
      moving: false,
      idleSeconds: 30,
      vx: 0,
      vy: 0,
      distanceTo: () => 999,
    } as CursorTracker,
    needs: opts.needs,
    memory: opts.memory ?? new Memory(),
    world,
    userActivity:
      opts.user ??
      makeTestSnapshot({
        category: "unknown",
        overallActivity: 0.2,
        userBusy: false,
        userIdle: false,
        secondsSinceLastInput: 30,
      }),
    stateId: "IDLE",
    idleSeconds: opts.idleSeconds ?? 10,
    hour: opts.hour ?? 14,
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

/** Simule l'arrivée goTo avec timeout distance-aware. */
function simulateGoToArrival(
  bodyX: number,
  goal: Goal,
): { arrived: boolean; reason?: string; hang?: boolean; mime?: boolean } {
  if (goal.kind !== "goTo") return { arrived: false, reason: "not-goto" };
  const dist = Math.abs(goal.x - bodyX);
  const budget = goal.timeoutSec ?? goToTimeoutSec(dist, WALK_SPEED);
  const travelTime = dist / WALK_SPEED;
  if (travelTime > budget) {
    return { arrived: false, reason: "goToTimeout" };
  }
  // Arrivée OK → évaluer then
  if (!goal.then) return { arrived: true };
  if (goal.then.kind === "perch") {
    // Gate approx : edge still near (body now at target)
    return { arrived: true, hang: true };
  }
  if (goal.then.kind === "activity" && (goal.then.state === "PUSH" || goal.then.state === "PULL")) {
    return { arrived: true, mime: true };
  }
  return { arrived: true };
}

function simulateProfile(
  name: string,
  build: (i: number) => BrainContext,
  n = 200,
): { counts: Counts; hangOk: number; hangFail: number; winOk: number; winFail: number } {
  const counts: Counts = {};
  const mem = new Memory();
  let now = 1_000_000;
  let hangOk = 0;
  let hangFail = 0;
  let winOk = 0;
  let winFail = 0;

  for (let i = 0; i < n; i++) {
    const ctx = build(i);
    ctx.memory = mem;
    ctx.now = now;
    const pick = pickOnce(ctx);
    if (!pick) {
      counts["(none)"] = (counts["(none)"] ?? 0) + 1;
      now += 12_000;
      continue;
    }
    counts[pick.id] = (counts[pick.id] ?? 0) + 1;

    const cons = ALL_CONSIDERATIONS.find((c) => c.id === pick.id)!;
    mem.remember(pick.id, now, cons.cooldownMs ?? 30_000);

    if (pick.id === "perch") {
      const r = simulateGoToArrival(ctx.body.x, pick.goal);
      if (r.hang) hangOk++;
      else hangFail++;
    }
    if (pick.id === "window") {
      const r = simulateGoToArrival(ctx.body.x, pick.goal);
      if (r.mime) winOk++;
      else winFail++;
    }

    now += 15_000 + Math.random() * 10_000;

    if (pick.id === "walk") {
      ctx.needs.boredom = Math.max(0, ctx.needs.boredom - 8);
    }
    if (pick.id === "look") {
      ctx.needs.curiosity = Math.max(0, ctx.needs.curiosity - 6);
    }
    if (pick.id === "idle") {
      ctx.needs.boredom = Math.min(100, ctx.needs.boredom + 3);
    }
  }

  console.log(`\n=== ${name} (${n} décisions) ===`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`${k.padEnd(14)} ${v}`);
  }
  if (hangOk + hangFail > 0) {
    console.log(
      `  → perch→HANG arrivés: ${hangOk}/${hangOk + hangFail} (échecs goTo: ${hangFail})`,
    );
  }
  if (winOk + winFail > 0) {
    console.log(
      `  → window→PUSH/PULL: ${winOk}/${winOk + winFail} (échecs goTo: ${winFail})`,
    );
  }
  return { counts, hangOk, hangFail, winOk, winFail };
}

function merge(all: Counts[]): Counts {
  const out: Counts = {};
  for (const c of all) {
    for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function scoreNear(): void {
  const near = ctxOf({
    needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 75 }),
    window: true,
    windowDist: 100,
    bodyX: 600,
    idleSeconds: 10,
  });
  const far = ctxOf({
    needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 75 }),
    window: true,
    windowDist: 550,
    bodyX: 600,
    idleSeconds: 10,
  });
  const walk = ALL_CONSIDERATIONS.find((c) => c.id === "walk")!;
  const win = ALL_CONSIDERATIONS.find((c) => c.id === "window")!;
  console.log("\n--- Window vs Walk (distance) ---");
  console.log(`NEAR dist~100: window=${win.utility(near).toFixed(3)} walk=${walk.utility(near).toFixed(3)}`);
  console.log(`FAR  dist~550: window=${win.utility(far).toFixed(3)} walk=${walk.utility(far).toFixed(3)}`);

  const mem = new Memory();
  mem.remember("perch", 1_000_000, 260_000);
  const afterPerch = ctxOf({
    needs: makeNeeds({ curiosity: 70, boredom: 40 }),
    edge: true,
    memory: mem,
    now: 1_060_000,
  });
  const perch = ALL_CONSIDERATIONS.find((c) => c.id === "perch")!;
  console.log(
    `Memory ready perch 60s after: utility=${perch.utility(afterPerch).toFixed(3)} (expect 0)`,
  );
}

const results = [
  simulateProfile("A inactif / énergique", () =>
    ctxOf({
      needs: makeNeeds({ energy: 85, fatigue: 15, boredom: 40, curiosity: 55 }),
      idleSeconds: 12,
      user: makeTestSnapshot({
        userIdle: true,
        secondsSinceLastInput: 400,
        overallActivity: 0.05,
        category: "browser",
      }),
    }),
  ),
  simulateProfile("B fatiguée", () =>
    ctxOf({
      needs: makeNeeds({ energy: 22, fatigue: 78, boredom: 25, curiosity: 40 }),
      hour: 23,
    }),
  ),
  simulateProfile("C ennuyée", () =>
    ctxOf({
      needs: makeNeeds({ energy: 65, fatigue: 25, boredom: 82, curiosity: 60 }),
      idleSeconds: 15,
    }),
  ),
  simulateProfile("D coding long", () =>
    ctxOf({
      needs: makeNeeds({ energy: 55, fatigue: 48, boredom: 40, curiosity: 45 }),
      hour: 11,
      user: makeTestSnapshot({
        category: "coding",
        activeAppDurationSec: 50 * 60,
        overallActivity: 0.85,
        userBusy: true,
        secondsSinceLastInput: 2,
      }),
    }),
  ),
  simulateProfile("E fenêtre PROCHE", () =>
    ctxOf({
      needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 75 }),
      window: true,
      windowDist: 100,
      bodyX: 600,
    }),
  ),
  simulateProfile("E2 fenêtre LOIN", () =>
    ctxOf({
      needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 55, curiosity: 75 }),
      window: true,
      windowDist: 600,
      bodyX: 600,
    }),
  ),
  simulateProfile("F bord proche", () =>
    ctxOf({
      needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 50, curiosity: 80 }),
      edge: true,
      edgeOffset: 40,
      bodyX: 600,
    }),
  ),
  simulateProfile("F2 bord LOIN (1800px)", () =>
    ctxOf({
      needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 50, curiosity: 80 }),
      edge: true,
      edgeOffset: 1800,
      bodyX: 600,
    }),
  ),
  simulateProfile("G sans interaction + edge+fenêtre proches", () =>
    ctxOf({
      needs: makeNeeds({ energy: 75, fatigue: 18, boredom: 70, curiosity: 65 }),
      idleSeconds: 25,
      window: true,
      windowDist: 120,
      edge: true,
      edgeOffset: 50,
      user: makeTestSnapshot({
        userIdle: true,
        secondsSinceLastInput: 600,
        overallActivity: 0,
      }),
    }),
  ),
];

const TOTAL = merge(results.map((r) => r.counts));
const totalN = Object.values(TOTAL).reduce((a, b) => a + b, 0);
const hangOk = results.reduce((a, r) => a + r.hangOk, 0);
const hangFail = results.reduce((a, r) => a + r.hangFail, 0);
const winOk = results.reduce((a, r) => a + r.winOk, 0);
const winFail = results.reduce((a, r) => a + r.winFail, 0);

console.log(`\n##############################`);
console.log(`TOTAL agrégé ~${totalN} décisions`);
for (const [k, v] of Object.entries(TOTAL).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(14)} ${String(v).padStart(4)}  (${((100 * v) / totalN).toFixed(1)}%)`);
}
console.log(`\nChaînes spatiales (simu arrivée):`);
console.log(`  perch→HANG: ${hangOk} OK / ${hangFail} fail (${hangOk + hangFail} picks)`);
console.log(`  window→mime: ${winOk} OK / ${winFail} fail (${winOk + winFail} picks)`);

scoreNear();
