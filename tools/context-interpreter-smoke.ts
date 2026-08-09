/**
 * Smoke tests LocalContextInterpreter + modifiers + anti-trigger.
 * Usage: npx --yes tsx tools/context-interpreter-smoke.ts
 */

import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { emptyEnvironment } from "../src/environment/EnvironmentContext";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { userActivityFactor } from "../src/user/activityModifiers";
import {
  interpretRules,
  LocalContextInterpreter,
} from "../src/user/LocalContextInterpreter";
import { __test as ollamaTest } from "../src/user/OllamaContextClient";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok — ${msg}`);
}

function mockCtx(
  partial: Partial<BrainContext> & { needs?: Needs; memory?: Memory },
): BrainContext {
  const needs = partial.needs ?? new Needs();
  const memory = partial.memory ?? new Memory();
  const userActivity =
    partial.userActivity ??
    makeTestSnapshot({ category: "unknown", userBusy: false, userIdle: false });
  return {
    now: partial.now ?? 1_000_000,
    body: (partial.body ?? { x: 600, y: 900 }) as Body,
    cursor: (partial.cursor ?? {
      x: 650,
      y: 820,
      moving: true,
      idleSeconds: 0.5,
      vx: 40,
      vy: 0,
      distanceTo: () => 90,
    }) as CursorTracker,
    needs,
    memory,
    world: (partial.world ?? {
      originX: 0,
      originY: 0,
      width: 1400,
      height: 900,
      scaleFactor: 2,
      monitors: [],
      windows: [],
      points: [{ kind: "floor", x: 400, y: 900 }],
      nearestWindow: {
        id: 1,
        title: "Test",
        x: 500,
        y: 100,
        width: 400,
        height: 300,
      },
      nearestEdge: { x: 20, y: 200, facing: 1 as const, kind: "screen" },
    }) as WorldSnapshot,
    userActivity,
    environment: emptyEnvironment(),
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 10,
    hour: partial.hour ?? 14,
  };
}

// 1. coding long + busy → focused_work, cursor ↓, walk/work pas forcés
{
  const snap = makeTestSnapshot({
    category: "coding",
    activeAppDurationSec: 40 * 60,
    overallActivity: 0.85,
    keyboardActivity: 0.9,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 1,
  });
  const interpreted = interpretRules(snap);
  assert(interpreted.mode === "focused_work", "1. mode focused_work");
  assert(interpreted.disturbanceTolerance === "low", "1. disturb=low");
  assert(interpreted.source === "rules", "1. source=rules");
  assert(interpreted.autonomyBias >= 0.8, "1. autonomyBias élevé");
  assert(!("suggestedGoal" in interpreted), "1. pas de suggestedGoal");

  const ctx = mockCtx({ userActivity: snap, interpretedContext: interpreted });
  assert(userActivityFactor("cursor", ctx) < 0.3, "1. cursor factor ↓↓");
  assert(userActivityFactor("walk", ctx) > 1, "1. walk soft ↑ (pas forcé)");
  assert(userActivityFactor("work", ctx) > 1, "1. work soft ↑ (pas forcé)");
  // utility===0 reste 0 (Needs/Memory prioritaires)
  const tired = new Needs();
  tired.energy = 100;
  tired.fatigue = 0;
  tired.boredom = 0;
  const memCtx = mockCtx({
    needs: tired,
    memory: new Memory(),
    userActivity: snap,
    environment: emptyEnvironment(),
    interpretedContext: interpreted,
  });
  // sleep gated by needs — factor soft n'impose pas le goal
  assert(sleepUtilityZeroOrSoft(memCtx), "1. pas de forçage sleep via contexte");
}

function sleepUtilityZeroOrSoft(ctx: BrainContext): boolean {
  const sleep = ALL_CONSIDERATIONS.find((c) => c.id === "sleep");
  if (!sleep) return false;
  const u = sleep.utility(ctx);
  // Si needs ne justifient pas sleep, utility doit rester 0 même en focused_work.
  return u === 0 || u < 0.5;
}

// 2. gaming → low disturb, pas de chase boost
{
  const snap = makeTestSnapshot({
    category: "gaming",
    overallActivity: 0.7,
    pointerActivity: 0.8,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 0.5,
  });
  const interpreted = interpretRules(snap);
  assert(interpreted.mode === "gaming", "2. mode gaming");
  assert(interpreted.disturbanceTolerance === "low", "2. disturb=low");
  const ctx = mockCtx({ userActivity: snap, interpretedContext: interpreted });
  assert(userActivityFactor("cursor", ctx) < 0.2, "2. cursor quasi coupé");
  assert(userActivityFactor("idle", ctx) > 1, "2. idle autonome OK");
  assert(userActivityFactor("dance", ctx) < 1, "2. dance ↓");
}

// 3. idle long → idle_away, look ↑ soft
{
  const snap = makeTestSnapshot({
    category: "unknown",
    overallActivity: 0.02,
    secondsSinceLastInput: 600,
    userBusy: false,
    userIdle: true,
  });
  const interpreted = interpretRules(snap);
  assert(interpreted.mode === "idle_away", "3. mode idle_away");
  assert(interpreted.disturbanceTolerance === "high", "3. disturb=high");
  assert(interpreted.socialOpenness > 0.5, "3. socialOpenness ↑");
  const ctx = mockCtx({ userActivity: snap, interpretedContext: interpreted });
  assert(userActivityFactor("look", ctx) > 1.15, "3. look ↑ soft");
  assert(userActivityFactor("window", ctx) > 1, "3. window ↑ soft");
  // cursor légèrement ↑ mais pas chase forcé
  assert(userActivityFactor("cursor", ctx) > 1 && userActivityFactor("cursor", ctx) < 1.2, "3. cursor mild ↑");
}

// 4. switching apps → mode switching, pas d'anim obligatoire
{
  const snap = makeTestSnapshot({
    category: "browser",
    appSwitchCountRecent: 7,
    lastAppChangeSec: 30,
    userBusy: false,
    userIdle: false,
    overallActivity: 0.4,
  });
  const interpreted = interpretRules(snap);
  assert(interpreted.mode === "switching_apps", "4. mode switching_apps");
  const ctx = mockCtx({ userActivity: snap, interpretedContext: interpreted });
  assert(userActivityFactor("look", ctx) > 1.1, "4. look boost soft");
  // Aucun goal forcé : utilities restent gated
  const needs = new Needs();
  needs.energy = 80;
  needs.fatigue = 10;
  needs.boredom = 10;
  needs.curiosity = 20;
  const gated = mockCtx({ needs, userActivity: snap, interpretedContext: interpreted });
  const dance = ALL_CONSIDERATIONS.find((c) => c.id === "dance")!;
  assert(dance.utility(gated) === 0 || dance.utility(gated) < 0.4, "4. pas d'anim obligatoire");
}

// 5. Ollama down / flag off → source=rules toujours
{
  const interp = new LocalContextInterpreter();
  const snap = makeTestSnapshot({
    category: "coding",
    userBusy: true,
    userIdle: false,
    overallActivity: 0.8,
    activeAppDurationSec: 30 * 60,
  });
  // flag off par défaut
  const out = interp.update(snap, ["appChanged"]);
  assert(out.source === "rules", "5. flag off → source=rules");
  assert(out.mode === "focused_work", "5. rules toujours appliquées");
}

// 6. Réponse Ollama invalide → ignore, garde rules
{
  assert(ollamaTest.parseClassification("not json at all") === null, "6. texte invalide → null");
  assert(ollamaTest.parseClassification('{"mode":"hack","confidence":0.9}') === null, "6. mode invalide → null");
  assert(
    ollamaTest.parseClassification(
      '{"mode":"focused_work","confidence":"x","disturbanceTolerance":"low","socialOpenness":0.2,"autonomyBias":0.8}',
    ) === null,
    "6. confidence non numérique → null",
  );
  const valid = ollamaTest.parseClassification(
    'Here: {"mode":"gaming","confidence":0.9,"disturbanceTolerance":"low","socialOpenness":0.1,"autonomyBias":0.9,"summary":"gaming"}',
  );
  assert(valid?.mode === "gaming", "6. JSON valide extrait");
  const payload = ollamaTest.anonymizedPayload(
    makeTestSnapshot({
      activeApp: "SecretApp",
      activeAppBundleId: "com.secret",
      category: "coding",
    }),
  );
  assert(!("activeApp" in payload), "6. payload anonymisé sans nom d'app");
  assert(!("activeAppBundleId" in payload), "6. payload anonymisé sans bundle");
}

// 7. Aucune consideration ne target la fenêtre / app frontmost
{
  const snap = makeTestSnapshot({
    activeApp: "Xcode",
    activeAppBundleId: "com.apple.dt.Xcode",
    category: "coding",
    userBusy: true,
    userIdle: false,
    overallActivity: 0.9,
    activeAppDurationSec: 50 * 60,
  });
  const interpreted = interpretRules(snap);
  const needs = new Needs();
  needs.energy = 60;
  needs.fatigue = 40;
  needs.boredom = 50;
  needs.curiosity = 55;
  needs.social = 40;
  const ctx = mockCtx({ needs, userActivity: snap, interpretedContext: interpreted });

  for (const c of ALL_CONSIDERATIONS) {
    const goal = c.buildGoal(ctx);
    const blob = JSON.stringify(goal);
    assert(
      !blob.includes("Xcode") &&
        !blob.includes("com.apple.dt.Xcode") &&
        !blob.includes("activeApp") &&
        !blob.includes("frontmost"),
      `7. ${c.id} ne cible pas l'app active`,
    );
  }
}

console.log("\nAll context-interpreter smoke tests passed.");
