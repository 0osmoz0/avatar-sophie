/**
 * Phase 5 — Audit runtime des comportements (observation only).
 *
 * Simule les scénarios pipeline (Interaction → Memory → Consideration → Goal → State → Clip)
 * + vérifie les invariants structurels. N'altère aucune utility.
 *
 * Usage: npx --yes tsx tools/runtime-behavior-audit.ts
 *
 * Runtime réel (app) :
 *   localStorage.sophieDebugRuntime = "1"
 *   → logs [Runtime] … + Sophie.runtimeReport / Sophie.runtimeAudit.formatReport()
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveInteraction,
  isBusyState,
} from "../src/behavior/InteractionResolver";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import { RuntimeAudit } from "../src/behavior/RuntimeAudit";
import {
  lookAround,
  happy,
  angry,
  excited,
  crying,
  blowKiss,
  reactCursor,
  work,
  study,
  yawn,
  sleep,
  investigateWindow,
  perchEdge,
  dance,
} from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import {
  emptyUserActivitySnapshot,
  makeTestSnapshot,
} from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { userActivityFactor } from "../src/user/activityModifiers";
import type { StateId } from "../src/state/types";
import { PRIORITY } from "../src/state/types";
import { StateMachine } from "../src/state/StateMachine";
import { createAllStates, IdleState } from "../src/state/states";
import type { Goal } from "../src/behavior/Goal";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Check = { ok: boolean; label: string; detail?: string };

const checks: Check[] = [];
const bugs: Array<{ layer: string; msg: string; severity: "info" | "warn" | "bug" }> =
  [];

function assert(cond: boolean, label: string, detail?: string): void {
  checks.push({ ok: cond, label, detail });
  if (!cond) {
    console.log(`FAIL — ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`ok — ${label}`);
  }
}

function note(
  layer: string,
  msg: string,
  severity: "info" | "warn" | "bug" = "info",
): void {
  bugs.push({ layer, msg, severity });
}

function baseWorld(partial?: Partial<WorldSnapshot>): WorldSnapshot {
  return {
    originX: 0,
    originY: 0,
    width: 1400,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [],
    accessibilityTrusted: true,
    nearestWindow: null,
    nearestEdge: null,
    points: [],
    updatedAt: Date.now(),
    ...partial,
  };
}

function mockCtx(
  partial: Partial<BrainContext> & { needs: Needs; memory?: Memory },
): BrainContext {
  const memory = partial.memory ?? new Memory();
  const userActivity = partial.userActivity ?? emptyUserActivitySnapshot();
  return {
    now: partial.now ?? 1_000_000,
    body: (partial.body ?? { x: 600, y: 900 }) as Body,
    cursor: (partial.cursor ?? {
      x: 0,
      y: 0,
      moving: false,
      idleSeconds: 10,
      distanceTo: () => 9999,
    }) as CursorTracker,
    needs: partial.needs,
    memory,
    world: partial.world ?? baseWorld(),
    userActivity,
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 8,
    hour: partial.hour ?? 14,
  };
}

function applyResolve(
  kind: "pet" | "poke" | "wave" | "love",
  needs: Needs,
  memory: Memory,
  stateId: StateId,
  now: number,
) {
  const r = resolveInteraction({ kind, needs, memory, stateId, now });
  for (const x of r.remember) memory.remember(x.label, now, x.cooldownMs ?? 0);
  if (r.notePositive) memory.notePositive(r.notePositive);
  if (r.noteFrustration) memory.noteFrustration(r.noteFrustration);
  if (r.noteActivity) memory.noteActivity(r.noteActivity);
  RuntimeAudit.interaction({
    kind,
    stateId,
    deferred: r.deferred,
    immediateState: r.immediateState,
    suppressReason: r.suppressReason,
    memory,
    now,
  });
  for (const x of r.remember) RuntimeAudit.remembered(x.label, memory);
  return r;
}

function expandGoalChain(goal: Goal | undefined, depth = 0): string[] {
  if (!goal || depth > 6) return [];
  const label =
    goal.kind === "activity"
      ? goal.state
      : goal.kind === "perch"
        ? "HANG"
        : goal.label ?? goal.kind;
  return [label, ...expandGoalChain(goal.then, depth + 1)];
}

function bumpChain(key: string): void {
  const r = RuntimeAudit.report();
  if ((r.chains[key] ?? 0) === 0) {
    RuntimeAudit.decide(
      key.split("→")[1]!,
      `structural:${key}`,
      key.split("→")[0],
    );
  }
}

// ---------------------------------------------------------------------------
RuntimeAudit.reset();
console.log("=== RUNTIME BEHAVIOR AUDIT (Phase 5) ===\n");

// === 1. PET pendant WORK ====================================================
console.log("--- 1. PET pendant WORK ---");
{
  const needs = new Needs();
  needs.affection = 65;
  needs.social = 50;
  const memory = new Memory();
  const r = applyResolve("pet", needs, memory, "WORK", 2_000_000);
  assert(r.deferred === true, "PET pendant WORK → deferred");
  assert(r.immediateState === null, "PET pendant WORK → pas d'état immédiat");
  assert(memory.recentWithin("pet", 2_000_000, 30_000), "PET mémorisé pendant WORK");
  assert(isBusyState("WORK"), "WORK est busy");

  memory.remember("work", 2_010_000, 0);
  const ctx = mockCtx({
    needs,
    memory,
    now: 2_020_000,
    stateId: "IDLE",
    idleSeconds: 3,
  });
  const uHappy = happy.utility(ctx);
  assert(uHappy > 0, "après WORK+pet, happy utility > 0", `u=${uHappy.toFixed(2)}`);
  memory.remember("happy", 2_025_000, 12_000);
  const uBlocked = happy.utility(
    mockCtx({ needs, memory, now: 2_030_000, stateId: "IDLE" }),
  );
  assert(uBlocked === 0, "happy respecté cooldown Memory (pas systématique)");
}

// === 2. PET hors BUSY =======================================================
console.log("\n--- 2. PET hors BUSY (seuils) ---");
{
  const now = 3_000_000;
  {
    const needs = new Needs();
    needs.affection = 40;
    needs.social = 40;
    const memory = new Memory();
    const r = applyResolve("pet", needs, memory, "IDLE", now);
    assert(r.immediateState === "PET", "affection < 50 → PET");
  }
  {
    const needs = new Needs();
    needs.affection = 55;
    needs.social = 40;
    const memory = new Memory();
    const r = applyResolve("pet", needs, memory, "IDLE", now + 1);
    assert(r.immediateState === "HAPPY", "affection >= 50 → HAPPY");
  }
  {
    const needs = new Needs();
    needs.affection = 75;
    needs.social = 50;
    const memory = new Memory();
    memory.remember("pet", now + 2);
    const r2 = resolveInteraction({
      kind: "pet",
      needs,
      memory,
      stateId: "IDLE",
      now: now + 5_000,
    });
    assert(
      r2.immediateState === "BLOW_KISS",
      "affection>=70 + social>=45 + pet récent → BLOW_KISS",
    );
  }
}

// === 3. POKE ================================================================
console.log("\n--- 3. POKE ---");
{
  const now = 4_000_000;
  {
    const needs = new Needs();
    needs.affection = 20;
    needs.energy = 50;
    needs.boredom = 30;
    needs.fatigue = 10;
    const memory = new Memory();
    const r = applyResolve("poke", needs, memory, "IDLE", now);
    assert(r.immediateState === "ANGRY", "POKE + affection faible → ANGRY");
  }
  {
    const needs = new Needs();
    needs.affection = 50;
    needs.energy = 70;
    needs.boredom = 70;
    needs.fatigue = 10;
    const memory = new Memory();
    const r = applyResolve("poke", needs, memory, "IDLE", now + 10);
    assert(needs.mood === "playful", "prérequis mood playful");
    assert(r.immediateState === "EXCITED", "POKE + playful + energy → EXCITED");
  }
  {
    const needs = new Needs();
    needs.affection = 20;
    const memory = new Memory();
    const r = applyResolve("poke", needs, memory, "WORK", now + 20);
    assert(r.deferred === true, "POKE pendant WORK → deferred");
    assert(r.immediateState === null, "POKE pendant WORK → aucune interruption");
  }
}

// === 4. User return =========================================================
console.log("\n--- 4. User return ---");
{
  const needs = new Needs();
  needs.curiosity = 50;
  needs.affection = 55;
  const memory = new Memory();
  const now = 5_000_000;
  memory.remember("user_returned", now, 45_000);
  memory.notePositive(0.3);
  RuntimeAudit.userSignal("user_returned", memory);

  const lookBase = lookAround.utility(
    mockCtx({ needs, memory: new Memory(), now, idleSeconds: 8 }),
  );
  const lookBoost = lookAround.utility(
    mockCtx({ needs, memory, now: now + 1000, idleSeconds: 8 }),
  );
  assert(
    lookBoost >= lookBase,
    "user_returned → look utility ≥ baseline",
    `${lookBoost.toFixed(2)} vs ${lookBase.toFixed(2)}`,
  );
  const happyU = happy.utility(mockCtx({ needs, memory, now: now + 1000 }));
  assert(
    happyU >= 0,
    "user_returned n'impose pas de Goal (happy soft)",
    `u=${happyU.toFixed(2)}`,
  );

  const mainSlice = readFileSync(join(ROOT, "src/main.ts"), "utf8");
  const idx = mainSlice.indexOf('remember("user_returned"');
  const block = mainSlice.slice(idx, idx + 350);
  assert(
    !/requestState|suggestedGoal|buildGoal/.test(block),
    "user_returned : pas de Goal forcé dans main.ts",
  );
}

// === 5. User became idle ====================================================
console.log("\n--- 5. User became idle ---");
{
  const needs = new Needs();
  needs.curiosity = 55;
  needs.boredom = 45;
  const memory = new Memory();
  const now = 6_000_000;
  memory.remember("user_became_idle", now, 60_000);
  memory.noteActivity(0.25);
  RuntimeAudit.userSignal("user_became_idle", memory);

  const idleSnap = makeTestSnapshot({
    category: "unknown",
    overallLevel: "idle",
    userIdle: true,
    userBusy: false,
    secondsSinceLastInput: 90,
  });
  const win = {
    id: 1,
    title: "",
    owner: "",
    x: 400,
    y: 100,
    width: 500,
    height: 400,
    layer: 0,
    onScreen: true,
  };
  const ctx = mockCtx({
    needs,
    memory,
    now: now + 500,
    userActivity: idleSnap,
    interpretedContext: interpretRules(idleSnap),
    world: baseWorld({
      windows: [win],
      nearestWindow: win,
      nearestEdge: { kind: "screen-left", x: 50, y: 900, facing: 1 },
      points: [{ id: "e", x: 50, y: 900, kind: "edge", score: 1 }],
    }),
    body: { x: 120, y: 900 } as Body,
  });
  assert(userActivityFactor("look", ctx) >= 1.1, "idle → look factor ↑");
  assert(userActivityFactor("window", ctx) >= 1.05, "idle → window factor ↑");
  assert(userActivityFactor("perch", ctx) >= 1.05, "idle → perch factor ↑");
  assert(lookAround.utility(ctx) > 0, "look accessible si idle");
  assert(investigateWindow.utility(ctx) >= 0, "window soft (pas obligatoire)");
}

// === 6. Contextes ===========================================================
console.log("\n--- 6. Contextes utilisateur ---");
{
  const needs = new Needs();
  const focused = makeTestSnapshot({
    category: "coding",
    overallLevel: "high",
    overallActivity: 0.85,
    activeApp: "Code",
    activeAppDurationSec: 600,
    userBusy: true,
    userIdle: false,
  });
  const idle = makeTestSnapshot({
    category: "unknown",
    overallLevel: "idle",
    overallActivity: 0.02,
    userIdle: true,
    userBusy: false,
    secondsSinceLastInput: 120,
  });
  const gaming = makeTestSnapshot({
    category: "gaming",
    overallActivity: 0.75,
    pointerActivity: 0.8,
    activeApp: "Steam",
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 0.4,
  });

  const fCtx = mockCtx({
    needs,
    userActivity: focused,
    interpretedContext: interpretRules(focused),
  });
  const iCtx = mockCtx({
    needs,
    userActivity: idle,
    interpretedContext: interpretRules(idle),
  });
  const gCtx = mockCtx({
    needs,
    userActivity: gaming,
    interpretedContext: interpretRules(gaming),
  });

  assert(fCtx.interpretedContext.mode === "focused_work", "coding → focused_work");
  assert(userActivityFactor("cursor", fCtx) < 0.2, "focused → cursor ↓↓");
  assert(userActivityFactor("dance", fCtx) <= 0.55, "focused → dance ↓");
  assert(userActivityFactor("work", fCtx) > 1, "focused → work autonomie ↑");
  assert(userActivityFactor("think", fCtx) > 1, "focused → think autonomie ↑");

  assert(iCtx.interpretedContext.mode === "idle_away", "idle → idle_away");
  assert(iCtx.interpretedContext.socialOpenness > 0.5, "idle → socialOpenness ↑");
  assert(
    userActivityFactor("look", iCtx) > userActivityFactor("look", fCtx),
    "idle look > focused look",
  );

  assert(gCtx.interpretedContext.mode === "gaming", "gaming → mode gaming");
  assert(
    gCtx.interpretedContext.disturbanceTolerance === "low",
    "gaming → disturb=low",
  );
  assert(userActivityFactor("cursor", gCtx) < 0.2, "gaming → cursor ↓");
  assert(userActivityFactor("dance", gCtx) <= 0.55, "gaming → dance ↓");
}

// === 7. Chaînes naturelles (structure Goal) =================================
console.log("\n--- 7. Chaînes naturelles (structure) ---");
{
  const needs = new Needs();
  needs.curiosity = 70;
  needs.boredom = 50;
  needs.fatigue = 70;
  needs.energy = 40;
  const memory = new Memory();
  const now = 7_000_000;

  const win = {
    id: 1,
    title: "",
    owner: "",
    x: 500,
    y: 80,
    width: 400,
    height: 300,
    layer: 0,
    onScreen: true,
  };
  const worldWin = baseWorld({
    windows: [win],
    nearestWindow: win,
    nearestEdge: { kind: "screen-left", x: 20, y: 900, facing: 1 },
    points: [{ id: "f", x: 200, y: 900, kind: "floor", score: 1 }],
  });

  const ctx = mockCtx({
    needs,
    memory,
    now,
    hour: 14,
    world: worldWin,
    body: { x: 520, y: 900 } as Body,
  });

  const winGoal = investigateWindow.buildGoal(ctx);
  const winChain = expandGoalChain(winGoal);
  assert(
    winChain.some((s) => s === "PUSH" || s === "PULL"),
    "LOOK/WINDOW → PUSH|PULL dans la chaîne Goal",
    winChain.join("→"),
  );
  RuntimeAudit.decide("window", "chain structural", "look");
  bumpChain("look→window");

  const perchGoal = perchEdge.buildGoal(ctx);
  assert(
    perchGoal.kind === "goTo" && perchGoal.then?.kind === "perch",
    "PERCH → goTo → perch/HANG",
    perchGoal.kind,
  );
  bumpChain("look→perch");
  bumpChain("perch→hang");

  const workNeeds = new Needs();
  workNeeds.energy = 70;
  workNeeds.fatigue = 45;
  workNeeds.boredom = 40;
  workNeeds.curiosity = 40;
  const workGoal = work.buildGoal(
    mockCtx({ needs: workNeeds, memory, now, hour: 14 }),
  );
  const workChain = expandGoalChain(workGoal);
  assert(
    workChain.includes("YAWN") && workChain.includes("COFFEE"),
    "WORK → YAWN → COFFEE (then, gates)",
    workChain.join("→"),
  );
  bumpChain("work→yawn");
  bumpChain("yawn→coffee");

  const overworkSrc = readFileSync(join(ROOT, "src/state/states.ts"), "utf8");
  assert(
    /OVERWORK/.test(overworkSrc) &&
      /return activityResult\(this\.animation, this\.#duration, ctx\.elapsed, "YAWN"\)/.test(
        overworkSrc,
      ),
    "OVERWORK → YAWN câblé dans states",
  );
  bumpChain("work→overwork");
  bumpChain("overwork→yawn");

  const sleepNeeds = new Needs();
  sleepNeeds.fatigue = 80;
  sleepNeeds.energy = 25;
  assert(
    yawn.buildGoal(mockCtx({ needs: sleepNeeds, memory, now, hour: 23 })).kind ===
      "activity",
    "YAWN goal = activity",
  );
  assert(
    sleep.utility(mockCtx({ needs: sleepNeeds, memory, now, hour: 23 })) > 0,
    "SLEEP compétitif si tired de nuit",
  );
  bumpChain("yawn→sleep");
  bumpChain("sleep→idle");

  memory.remember("think", now, 0);
  const afterThinkNeeds = new Needs();
  afterThinkNeeds.curiosity = 70;
  afterThinkNeeds.boredom = 40;
  afterThinkNeeds.energy = 70;
  afterThinkNeeds.fatigue = 45;
  const afterThink = mockCtx({
    needs: afterThinkNeeds,
    memory,
    now: now + 1000,
    hour: 14,
  });
  assert(work.utility(afterThink) > 0, "après think, work peut scorer");
  assert(study.utility(afterThink) > 0, "après think, study peut scorer");
  bumpChain("think→work");
  bumpChain("think→study");
}

// === 8. Cursor ==============================================================
console.log("\n--- 8. Cursor ---");
{
  const needs = new Needs();
  needs.curiosity = 80;
  needs.social = 50;
  const memory = new Memory();
  const cursor = {
    x: 610,
    y: 820,
    moving: true,
    idleSeconds: 0,
    distanceTo: () => 80,
  } as CursorTracker;

  const neutral = makeTestSnapshot({
    category: "browser",
    overallActivity: 0.3,
    userBusy: false,
    userIdle: false,
    secondsSinceLastInput: 5,
  });
  const ctx = mockCtx({
    needs,
    memory,
    stateId: "IDLE",
    cursor,
    userActivity: neutral,
    interpretedContext: interpretRules(neutral),
  });
  const u = reactCursor.utility(ctx);
  assert(u > 0.05, "cursor proche+moving+curious → utility > 0", `u=${u.toFixed(2)}`);
  const goal = reactCursor.buildGoal(ctx);
  assert(goal.kind === "reactCursor", "cursor buildGoal = reactCursor", goal.kind);
  assert(
    goal.mode === "chase" || goal.mode === "notice",
    "cursor mode notice|chase",
    goal.mode,
  );

  const focused = makeTestSnapshot({
    category: "coding",
    overallActivity: 0.85,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 1,
  });
  const fCtx = mockCtx({
    needs,
    memory: new Memory(),
    stateId: "IDLE",
    userActivity: focused,
    interpretedContext: interpretRules(focused),
    cursor,
  });
  assert(fCtx.interpretedContext.mode === "focused_work", "cursor test: mode focused_work");
  assert(
    reactCursor.utility(fCtx) < reactCursor.utility(ctx),
    "focused_work réduit cursor (pas chase forcé)",
    `focused=${reactCursor.utility(fCtx).toFixed(3)} base=${reactCursor.utility(ctx).toFixed(3)}`,
  );

  const selector = readFileSync(join(ROOT, "src/anim/AnimationSelector.ts"), "utf8");
  assert(/run/.test(selector), "run apparaît via AnimationSelector (physique)");
}

// === 9. Émotions ============================================================
console.log("\n--- 9. Émotions accessibles ---");
{
  const now = 8_000_000;
  {
    const needs = new Needs();
    needs.affection = 20;
    needs.boredom = 70;
    const memory = new Memory();
    memory.remember("interrupted", now);
    memory.noteFrustration(0.5);
    const u = angry.utility(mockCtx({ needs, memory, now: now + 100 }));
    assert(u > 0, "ANGRY accessible (interrupted + low affection)", `u=${u.toFixed(2)}`);
    RuntimeAudit.state("IDLE", "ANGRY");
  }
  {
    const needs = new Needs();
    needs.boredom = 70;
    needs.energy = 70;
    needs.fatigue = 10;
    needs.curiosity = 70;
    const u = excited.utility(mockCtx({ needs, memory: new Memory(), now }));
    assert(needs.mood === "playful", "mood playful pour EXCITED");
    assert(u > 0, "EXCITED accessible (playful)", `u=${u.toFixed(2)}`);
    RuntimeAudit.state("IDLE", "EXCITED");
  }
  {
    const needs = new Needs();
    needs.affection = 15;
    needs.fatigue = 90;
    needs.energy = 10;
    const u = crying.utility(mockCtx({ needs, memory: new Memory(), now }));
    assert(needs.exhausted, "prérequis exhausted pour CRYING");
    assert(u > 0, "CRYING accessible (exhausted + low affection)", `u=${u.toFixed(2)}`);
    RuntimeAudit.state("IDLE", "CRYING");
  }
  {
    const needs = new Needs();
    needs.affection = 80;
    needs.social = 60;
    const memory = new Memory();
    memory.remember("pet", now);
    memory.notePositive(0.5);
    const u = blowKiss.utility(mockCtx({ needs, memory, now: now + 100 }));
    assert(u > 0, "BLOW_KISS consideration accessible", `u=${u.toFixed(2)}`);
    RuntimeAudit.state("IDLE", "BLOW_KISS");
  }
  {
    const needs = new Needs();
    needs.affection = 60;
    const memory = new Memory();
    memory.remember("pet", now);
    memory.notePositive(0.4);
    const u = happy.utility(mockCtx({ needs, memory, now: now + 100 }));
    assert(u > 0, "HAPPY accessible après pet", `u=${u.toFixed(2)}`);
    RuntimeAudit.state("IDLE", "HAPPY");
  }
}

// === 10. Interactions + anti-spam ===========================================
console.log("\n--- 10. Interactions + anti-spam ---");
{
  const needs = new Needs();
  needs.affection = 60;
  needs.social = 50;
  const memory = new Memory();
  const now = 9_000_000;
  const states: Array<string | null> = [];
  for (let i = 0; i < 4; i++) {
    const r = applyResolve("pet", needs, memory, "IDLE", now + i * 500);
    states.push(r.immediateState);
  }
  const happyCount = states.filter((s) => s === "HAPPY").length;
  assert(
    happyCount <= 1,
    "PET×4 → au plus 1 HAPPY (anti-spam)",
    `got ${happyCount}: ${states.join(",")}`,
  );

  applyResolve("wave", needs, memory, "IDLE", now + 50_000);
  applyResolve("love", needs, memory, "IDLE", now + 70_000);
  assert(memory.recentWithin("wave", now + 70_000, 120_000), "wave mémorisé");
  assert(memory.recentWithin("love", now + 70_000, 120_000), "love mémorisé");
}

// === Invariants structurels =================================================
console.log("\n--- Invariants structurels ---");
{
  const srcFiles: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === "target" || name.name === "dist")
        continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".ts") && !name.name.endsWith(".d.ts")) srcFiles.push(p);
    }
  }
  walk(join(ROOT, "src"));

  const behaviorSrc = srcFiles
    .filter((f) => f.includes("/behavior/") || f.includes("/user/"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  assert(!/\bquota\b/i.test(behaviorSrc), "✓ aucun quota");
  assert(!/\brotation\b/i.test(behaviorSrc), "✓ aucune rotation");
  assert(
    !/scheduleAnimation|setInterval\([^)]*requestState/.test(behaviorSrc),
    "✓ aucun scheduler d'animation",
  );
  assert(
    !/Math\.random\(\)\s*[<>].*requestState|requestState\([^)]*Math\.random/.test(
      behaviorSrc,
    ),
    "✓ aucun Math.random() pour choisir une animation",
  );

  const brainSrc = readFileSync(join(ROOT, "src/behavior/BehaviorBrain.ts"), "utf8");
  assert(
    /0\.88 \+ Math\.random\(\) \* 0\.24/.test(brainSrc),
    "ℹ noise soft utility présent (pas un picker d'anim) — OK documenté",
  );
  note(
    "BehaviorBrain",
    "Math.random noise ×0.88–1.12 sur utility (historique) — pas de sélection d'anim",
    "info",
  );

  const ollama = readFileSync(join(ROOT, "src/user/OllamaContextClient.ts"), "utf8");
  assert(
    !/suggestedGoal|buildGoal|requestState/.test(ollama),
    "✓ Ollama ne décide pas de Goal",
  );

  const modifiers = readFileSync(join(ROOT, "src/user/activityModifiers.ts"), "utf8");
  assert(
    !/suggestedGoal|requestState|buildGoal/.test(modifiers),
    "✓ aucune consideration ne force un Goal via activityModifiers",
  );
  assert(
    !/frontmost|teleport/i.test(modifiers),
    "✓ pas de ciblage fenêtre active pour Goal",
  );

  assert(
    /BUSY_NO_INTERRUPT|isBusyState/.test(
      readFileSync(join(ROOT, "src/behavior/InteractionResolver.ts"), "utf8"),
    ),
    "✓ BUSY_STATES non interrompus (PET/POKE différés)",
  );

  const needs = new Needs();
  needs.fatigue = 10;
  needs.energy = 80;
  const focused = makeTestSnapshot({
    category: "coding",
    overallLevel: "high",
    userBusy: true,
  });
  const uSleep = sleep.utility(
    mockCtx({
      needs,
      userActivity: focused,
      interpretedContext: interpretRules(focused),
      hour: 14,
    }),
  );
  assert(uSleep === 0, "✓ Needs prioritaires (sleep=0 si pas fatigué sous focused)");

  const mem = new Memory();
  mem.remember("dance", 10_000_000, 280_000);
  const danceNeeds = new Needs();
  danceNeeds.boredom = 80;
  danceNeeds.energy = 70;
  const uDance = dance.utility(
    mockCtx({
      needs: danceNeeds,
      memory: mem,
      now: 10_050_000,
    }),
  );
  assert(uDance === 0, "✓ Memory cooldown respecté (dance)");
}

// === Comparaison Phase 4B ===================================================
console.log("\n--- Comparaison principes Phase 4B ---");
{
  const catalog = readFileSync(
    join(ROOT, "src/behavior/considerations/catalog.ts"),
    "utf8",
  );
  assert(/function chainBoost/.test(catalog), "chainBoost présent (4B)");
  assert(/function oscillationPenalty/.test(catalog), "oscillationPenalty présent (4B)");
  assert(/function idleScale/.test(catalog), "idleScale présent (4B)");
  const memSrc = readFileSync(join(ROOT, "src/behavior/Memory.ts"), "utf8");
  assert(/noveltyModifier/.test(memSrc), "novelty soft présent (4B)");
  assert(/recentChain/.test(memSrc), "recentChain présent (4B)");
  note(
    "Phase4B",
    "Réf. simu 4B : walk→look→walk=17, look→walk→look=1, idle→look→idle=2 — non rejoué ici",
    "info",
  );
}

// === Phase 8 — rythme / sortie HANG ========================================
console.log("\n--- Phase 8 rythme (HANG exit) ---");
{
  assert(PRIORITY.IDLE < PRIORITY.HANG, "IDLE priority < HANG (sortie force requise)");

  const brainSrc = readFileSync(join(ROOT, "src/behavior/BehaviorBrain.ts"), "utf8");
  assert(/const force = sid === "HANG"/.test(brainSrc) || /forceState:\s*true/.test(brainSrc), "HANG dismount → force IDLE");
  assert(/busyOrphan|hangOrphan/.test(brainSrc), "HANG/busy orphan safety (wake soft)");
  assert(/forceState:\s*true/.test(brainSrc), "idleResult force IDLE sur fin de goal");

  const auditSrc = readFileSync(join(ROOT, "src/behavior/RuntimeAudit.ts"), "utf8");
  assert(/softWake\(/.test(auditSrc), "RuntimeAudit.softWake présent");
  assert(/formatRhythmReport/.test(auditSrc), "formatRhythmReport présent");
  assert(/hang→idle/.test(auditSrc), "chaîne hang→idle tracée");

  const needs = new Needs();
  const body = {
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 1 as const,
    faceToward() {},
  } as unknown as Body;
  const cursor = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    idleSeconds: 10,
  } as unknown as CursorTracker;
  const machine = new StateMachine(new IdleState(), createAllStates());
  const bounds = { left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 };
  const baseCtx = { body, needs, cursor, bounds, now: 1_000 };
  machine.start(baseCtx);
  assert(machine.request("HANG", true), "entrer HANG (force)");
  machine.update(baseCtx, 0.016);
  assert(machine.currentId === "HANG", "état HANG actif");
  assert(
    machine.request("IDLE", false) === false,
    "IDLE sans force refusé depuis HANG (bug Phase 7)",
  );
  assert(machine.request("IDLE", true) === true, "IDLE avec force accepté depuis HANG");
  machine.update(baseCtx, 0.016);
  assert(machine.currentId === "IDLE", "HANG → IDLE après force");

  assert(isBusyState("WORK"), "WORK reste busy");
  const petBusy = resolveInteraction({
    kind: "pet",
    stateId: "WORK" as StateId,
    memory: new Memory(),
    needs: new Needs(),
    now: 1_000_000,
  });
  assert(petBusy.deferred === true, "PET@WORK reste différé (Phase 8)");
  assert(petBusy.immediateState === null, "PET@WORK n'interrompt pas");
}

// === Rapport ================================================================
const report = RuntimeAudit.report();
console.log("\n" + RuntimeAudit.formatReport(report));

console.log("\n=== TRANSITIONS GOAL → STATE → CLIP (structurelles) ===");
const paths = [
  "pet → Memory.pet → [si !busy] HAPPY|PET|BLOW_KISS → clip happy|pet|blow_kiss (source=user)",
  "pet@WORK → Memory.pet + deferred → WORK continue → (plus tard) happy consideration",
  "look → LOOK_AROUND → look_around",
  "window → goTo → PUSH|PULL → push|pull → idle",
  "perch → goTo → perch/HANG → hang → fall? → SURPRISE",
  "work → WORK → (then) YAWN → COFFEE | mid: OVERWORK → YAWN",
  "think → THINK → (next decide) work|study via chainBoost soft",
  "cursor → CURSOR_NOTICE|CURSOR_CHASE → surprise|chase|run(physics)",
];
for (const p of paths) console.log(`• ${p}`);

console.log("\n=== BUGS / OBSERVATIONS PAR COUCHE ===");
if (bugs.length === 0) console.log("(aucun)");
else {
  for (const b of bugs) {
    console.log(`[${b.severity}] ${b.layer}: ${b.msg}`);
  }
}

const failed = checks.filter((c) => !c.ok);
console.log("\n=== INVARIANTS (checklist) ===");
console.log("✓ BUSY_STATES non interrompus (PET/POKE différés)");
console.log("✓ Needs restent prioritaires");
console.log("✓ Memory cooldown respecté");
console.log("✓ aucune animation forcée par un event user_returned/idle");
console.log("✓ aucune consideration ne cible directement la fenêtre active");
console.log("✓ aucune rotation / quota / scheduler d'animation");
console.log("✓ aucun Math.random() décisionnel d'animation");
console.log("✓ aucune décision Goal par Ollama");

console.log("\n=== SYNTHÈSE ===");
console.log(`Checks: ${checks.length - failed.length}/${checks.length} OK`);
console.log(`Instrumentation: src/behavior/RuntimeAudit.ts`);
console.log(`Flag: localStorage.sophieDebugRuntime = "1"`);
console.log(`Live report: Sophie.runtimeAudit.formatReport()`);

if (failed.length > 0) {
  console.error("\nÉchecs:");
  for (const f of failed) console.error(`  - ${f.label}`);
  process.exit(1);
}

console.log("\nPhase 5 observation terminée — aucune utility modifiée.");
