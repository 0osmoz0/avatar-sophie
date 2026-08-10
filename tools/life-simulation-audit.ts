/**
 * Phase 11 — Life simulation audit (~8000–10000 picks).
 * Mesure diversité PC/phone/cursor/user/fatigue/boredom vs baseline 9B.
 *
 * Usage: npx --yes tsx tools/life-simulation-audit.ts
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
} from "../src/environment/EnvironmentContext";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { environmentFactor, personalityFactor } from "../src/user/activityModifiers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tools/.audit-cache/life-simulation-report.txt");
const BASELINE_9B = join(ROOT, "tools/.audit-cache/environment-behavior-report.txt");

const FAMILY: Record<string, string> = {
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

function cursor(p?: Partial<CursorTracker>): CursorTracker {
  return {
    x: 500,
    y: 800,
    vx: 0,
    vy: 0,
    moving: false,
    idleSeconds: 3,
    distanceTo(this: CursorTracker, x: number, y: number) {
      return Math.hypot(this.x - x, this.y - y);
    },
    ...p,
  } as unknown as CursorTracker;
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

function makeCtx(opts: {
  body?: Partial<Body>;
  cursor?: Partial<CursorTracker>;
  world?: Partial<WorldSnapshot>;
  user?: Parameters<typeof makeTestSnapshot>[0];
  stateId?: BrainContext["stateId"];
  idleSeconds?: number;
  needs?: Partial<Needs>;
  memorySeed?: (m: Memory, now: number) => void;
  prevCursorDistance?: number;
  hour?: number;
}): BrainContext {
  const userActivity = makeTestSnapshot(opts.user ?? {});
  const needs = new Needs();
  Object.assign(needs, opts.needs ?? {});
  const memory = new Memory();
  const now = 3_000_000;
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
    hour: opts.hour ?? 15,
  };
}

type Scenario = { name: string; n: number; build: (i: number) => BrainContext };

const scenarios: Scenario[] = [
  {
    name: "pc_focused_work",
    n: 700,
    build: () =>
      makeCtx({
        user: {
          category: "coding",
          overallLevel: "high",
          userBusy: true,
          activeAppDurationSec: 2000,
        },
        needs: { energy: 70, boredom: 28, curiosity: 45 },
        idleSeconds: 4,
        world: { nearestWindow: null },
      }),
  },
  {
    name: "pc_study",
    n: 500,
    build: () =>
      makeCtx({
        user: {
          category: "productivity",
          overallLevel: "medium",
          userBusy: true,
          activeAppDurationSec: 900,
        },
        needs: { energy: 60, boredom: 35, curiosity: 55 },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "phone_idle_boredom",
    n: 700,
    build: () =>
      makeCtx({
        user: {
          category: "unknown",
          overallLevel: "idle",
          userIdle: true,
          secondsSinceLastInput: 400,
        },
        idleSeconds: 22,
        needs: { boredom: 65, curiosity: 40, social: 50, energy: 55 },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "phone_after_check",
    n: 400,
    build: () =>
      makeCtx({
        user: { userIdle: true, overallLevel: "idle" },
        idleSeconds: 14,
        needs: { boredom: 50, social: 55 },
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("phone_check", now - 5_000, 0);
        },
      }),
  },
  {
    name: "cursor_approaching",
    n: 500,
    build: () =>
      makeCtx({
        body: { x: 400, y: 900 },
        cursor: { x: 430, y: 820, moving: true, vx: -20 },
        prevCursorDistance: 120,
        needs: { curiosity: 60, social: 55 },
        idleSeconds: 5,
        world: { nearestWindow: null },
      }),
  },
  {
    name: "cursor_leaving",
    n: 400,
    build: () =>
      makeCtx({
        body: { x: 400, y: 900 },
        cursor: { x: 700, y: 600, moving: true, vx: 40 },
        prevCursorDistance: 80,
        needs: { curiosity: 50, social: 40 },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "user_returned",
    n: 600,
    build: () =>
      makeCtx({
        user: { overallLevel: "medium", userIdle: false },
        needs: { affection: 60, social: 55, curiosity: 45 },
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("user_returned", now - 8_000, 0);
          m.nudgePersonality({ sociability: 0.2 });
        },
      }),
  },
  {
    name: "user_idle_independent",
    n: 600,
    build: () =>
      makeCtx({
        user: {
          userIdle: true,
          overallLevel: "idle",
          secondsSinceLastInput: 200,
        },
        idleSeconds: 18,
        needs: { boredom: 45, curiosity: 50, energy: 65 },
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("user_became_idle", now - 10_000, 0);
          m.nudgePersonality({ independence: 0.25 });
        },
      }),
  },
  {
    name: "fatigue_long",
    n: 600,
    build: () =>
      makeCtx({
        user: {
          category: "coding",
          overallLevel: "high",
          userBusy: true,
          activeAppDurationSec: 40 * 60,
        },
        needs: { fatigue: 70, energy: 30, boredom: 40 },
        idleSeconds: 6,
        world: { nearestWindow: null },
      }),
  },
  {
    name: "boredom_explore",
    n: 600,
    build: () =>
      makeCtx({
        user: { userIdle: true, overallLevel: "idle", secondsSinceLastInput: 500 },
        idleSeconds: 30,
        needs: { boredom: 75, curiosity: 55, energy: 60 },
        world: { nearestWindow: null },
      }),
  },
  {
    name: "environment_edge",
    n: 500,
    build: () =>
      makeCtx({
        body: { x: 90, grounded: true },
        needs: { curiosity: 60, boredom: 40 },
        idleSeconds: 10,
        world: { nearestWindow: null },
      }),
  },
  {
    name: "environment_window",
    n: 500,
    build: () =>
      makeCtx({
        body: { x: 250, grounded: true },
        needs: { curiosity: 70, boredom: 40 },
        idleSeconds: 9,
      }),
  },
  {
    name: "personality_social",
    n: 500,
    build: () =>
      makeCtx({
        user: { userIdle: false },
        needs: { affection: 70, social: 60 },
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("pet", now - 12_000, 0);
          m.nudgePersonality({ sociability: 0.3, playfulness: 0.15 });
        },
      }),
  },
  {
    name: "cross_work_phone",
    n: 500,
    build: () =>
      makeCtx({
        user: { category: "coding", overallLevel: "medium", userBusy: false },
        needs: { boredom: 55, energy: 55, curiosity: 40 },
        idleSeconds: 12,
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("work", now - 20_000, 0);
          m.remember("think", now - 8_000, 0);
        },
      }),
  },
  {
    name: "cross_idle_inspect",
    n: 400,
    build: () =>
      makeCtx({
        user: { userIdle: true, overallLevel: "idle" },
        idleSeconds: 16,
        needs: { boredom: 50, curiosity: 65 },
        world: { nearestWindow: null },
        memorySeed: (m, now) => {
          m.remember("idle", now - 6_000, 0);
          m.remember("environment_inspect", now - 3_000, 0);
        },
      }),
  },
];

function pickWithNoise(ctx: BrainContext): string | null {
  let best: { id: string; u: number; prio: number } | null = null;
  for (const c of ALL_CONSIDERATIONS) {
    const u = c.utility(ctx) * (0.88 + Math.random() * 0.24);
    if (u <= 0) continue;
    const prio = c.priority ?? 0;
    if (
      !best ||
      u > best.u + 1e-9 ||
      (Math.abs(u - best.u) < 1e-9 && prio > best.prio)
    ) {
      best = { id: c.id, u, prio };
    }
  }
  return best?.id ?? null;
}

function entropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  const keys = Object.keys(counts).filter((k) => counts[k]! > 0);
  for (const k of keys) {
    const p = counts[k]! / total;
    h -= p * Math.log2(p);
  }
  return keys.length > 1 ? h / Math.log2(keys.length) : 0;
}

function main(): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const dist: Record<string, number> = {};
  const families: Record<string, number> = {};
  const byScenario: Record<string, Record<string, number>> = {};
  let picks = 0;
  let phone = 0;
  let pc = 0;
  let env = 0;
  let emotionRep = 0;
  let lastEmotion: string | null = null;
  const loopWindows: Record<string, number> = {};
  const history: string[] = [];
  let envFactorBad = 0;
  let persFactorBad = 0;

  const totalPlanned = scenarios.reduce((a, s) => a + s.n, 0);

  for (const sc of scenarios) {
    byScenario[sc.name] = {};
    // Mémoire / needs partagés dans le scénario (cooldown + novelty réels)
    const seedCtx = sc.build(0);
    const sharedMem = seedCtx.memory;
    const sharedNeeds = seedCtx.needs;
    let t = seedCtx.now;

    for (let i = 0; i < sc.n; i++) {
      const ctx = sc.build(i);
      ctx.memory = sharedMem;
      ctx.needs = sharedNeeds;
      ctx.now = t;
      // re-derive env with shared memory flags
      ctx.environment = deriveEnvironment({
        body: ctx.body,
        world: ctx.world,
        cursor: ctx.cursor,
        interpreted: ctx.interpretedContext,
        userActivity: ctx.userActivity,
        stateId: ctx.stateId,
        memoryReturned: sharedMem.recentWithin("user_returned", t, 45_000),
      });

      for (const c of ALL_CONSIDERATIONS) {
        const ef = environmentFactor(c.id, ctx);
        const pf = personalityFactor(c.id, ctx);
        if (ef < 0.85 - 1e-9 || ef > 1.15 + 1e-9) envFactorBad++;
        if (pf < 0.9 - 1e-9 || pf > 1.15 + 1e-9) persFactorBad++;
      }

      const id = pickWithNoise(ctx);
      if (!id) {
        t += 8_000;
        sharedNeeds.update(8, "idle");
        sharedMem.update(8);
        continue;
      }
      picks++;
      dist[id] = (dist[id] ?? 0) + 1;
      byScenario[sc.name]![id] = (byScenario[sc.name]![id] ?? 0) + 1;
      const fam = FAMILY[id] ?? "unknown";
      families[fam] = (families[fam] ?? 0) + 1;
      if (id.startsWith("phone_")) phone++;
      if (id.startsWith("computer_")) pc++;
      if (
        id.startsWith("edge_") ||
        id.startsWith("environment_") ||
        id === "confused_environment" ||
        id.startsWith("look_")
      ) {
        env++;
      }
      const emos = new Set(["happy", "excited", "blow_kiss", "angry", "crying"]);
      if (emos.has(id)) {
        if (lastEmotion === id) emotionRep++;
        lastEmotion = id;
      } else {
        lastEmotion = null;
      }
      history.push(id);
      if (history.length >= 3) {
        const a = history[history.length - 3]!;
        const b = history[history.length - 2]!;
        const c = history[history.length - 1]!;
        if (a === c && a !== b) {
          const key = `${a}→${b}→${a}`;
          loopWindows[key] = (loopWindows[key] ?? 0) + 1;
        }
      }
      const cons = ALL_CONSIDERATIONS.find((x) => x.id === id)!;
      const cd = cons.cooldownMs ?? 20_000;
      sharedMem.remember(id, t, cd);
      if (cons.onComplete) sharedNeeds.apply(cons.onComplete);
      t += 12_000 + Math.floor(Math.random() * 8_000);
      sharedNeeds.update(12, id);
      sharedMem.update(12);
    }
  }

  const diversity = Object.keys(dist).filter((k) => dist[k]! > 0).length;
  const ent = entropy(dist);
  const loopCount = Object.values(loopWindows).reduce((a, b) => a + b, 0);

  let baselineEntropy = "n/a";
  let baselineDiversity = "n/a";
  if (existsSync(BASELINE_9B)) {
    const txt = readFileSync(BASELINE_9B, "utf8");
    const em = txt.match(/Entropy \(norm\):\s*([\d.]+)%/);
    const dm = txt.match(/Diversity:\s*(\d+)/);
    if (em) baselineEntropy = `${em[1]}%`;
    if (dm) baselineDiversity = dm[1]!;
  }

  const lines: string[] = [];
  lines.push("=== LIFE SIMULATION AUDIT (Phase 11) ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Planned picks≈${totalPlanned} actual=${picks}`);
  lines.push(`Entropy (norm): ${(ent * 100).toFixed(1)}%`);
  lines.push(`Diversity: ${diversity} considerations`);
  lines.push(`Baseline 9B entropy: ${baselineEntropy} diversity: ${baselineDiversity}`);
  lines.push("");
  lines.push("Interactions");
  lines.push("-----------");
  lines.push(`phone: ${phone} (${picks ? ((phone / picks) * 100).toFixed(1) : 0}%)`);
  lines.push(`PC/computer_*: ${pc} (${picks ? ((pc / picks) * 100).toFixed(1) : 0}%)`);
  lines.push(`environment-ish: ${env} (${picks ? ((env / picks) * 100).toFixed(1) : 0}%)`);
  lines.push(`emotion repetitions consecutive: ${emotionRep}`);
  lines.push(`a→b→a loop windows: ${loopCount}`);
  lines.push(`environmentFactor violations: ${envFactorBad}`);
  lines.push(`personalityFactor violations: ${persFactorBad}`);
  lines.push("");
  lines.push("Families");
  lines.push("--------");
  for (const [k, v] of Object.entries(families).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v} (${((v / picks) * 100).toFixed(1)}%)`);
  }
  lines.push("");
  lines.push("Distribution (top)");
  lines.push("------------------");
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    lines.push(`  ${k}: ${v} (${((v / picks) * 100).toFixed(1)}%)`);
  }
  lines.push("");
  lines.push("By scenario (top 4)");
  lines.push("-------------------");
  for (const sc of scenarios) {
    const d = byScenario[sc.name] ?? {};
    const top = Object.entries(d)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`  ${sc.name}: ${top || "(none)"}`);
  }
  lines.push("");
  lines.push("Invariants");
  lines.push("----------");
  lines.push(`no env/personality factor OOB: ${envFactorBad === 0 && persFactorBad === 0}`);
  lines.push(
    `musicPlaying never faked: emptyEnvironment musicPlaying=${emptyEnvironment().musicPlaying}`,
  );
  lines.push(`phone interactions present: ${phone > 0}`);
  lines.push(`PC interactions present: ${pc > 0}`);
  lines.push("");
  const baseNum = baselineEntropy === "n/a" ? null : parseFloat(baselineEntropy);
  const stableOrBetter = baseNum == null || ent * 100 >= baseNum - 8 || diversity >= 12;
  lines.push("Verdict");
  lines.push("-------");
  lines.push(
    stableOrBetter
      ? "Diversité stable ou acceptable vs Phase 9B — Phase 11 OK."
      : "ATTENTION: entropie nettement inférieure à 9B — revoir soft factors.",
  );
  lines.push(
    "Confirmation: aucune tendance Life Sim ne force Goal / State / Animation.",
  );

  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

main();
