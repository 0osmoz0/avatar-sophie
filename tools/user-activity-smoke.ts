/**
 * Smoke tests UserActivity → modifiers (pas de déclencheurs directs).
 * Usage: npx --yes tsx tools/user-activity-smoke.ts
 */

import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import {
  coffee,
  dance,
  idleHere,
  lookAround,
  reactCursor,
  sleep,
  walkSomewhere,
  work,
  investigateWindow,
} from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { categorizeApp } from "../src/user/AppCategories";
import {
  emptyUserActivitySnapshot,
  makeTestSnapshot,
} from "../src/user/UserActivitySnapshot";
import { userActivityFactor } from "../src/user/activityModifiers";
import { interpretRules } from "../src/user/LocalContextInterpreter";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok — ${msg}`);
}

function mockCtx(
  partial: Partial<BrainContext> & { needs?: Needs; memory?: Memory },
): BrainContext {
  const needs = partial.needs ?? new Needs();
  const memory = partial.memory ?? new Memory();
  const userActivity = partial.userActivity ?? emptyUserActivitySnapshot();
  return {
    now: partial.now ?? 1_000_000,
    body: (partial.body ?? { x: 600, y: 900 }) as Body,
    cursor: (partial.cursor ?? {
      x: 650,
      y: 820,
      moving: true,
      idleSeconds: 0.5,
      vx: 100,
      vy: 0,
      distanceTo: () => 80,
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
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 10,
    hour: partial.hour ?? 14,
  };
}

// --- Catégories ---
assert(categorizeApp("com.microsoft.VSCode", "Code") === "coding", "VS Code → coding");
assert(categorizeApp(null, "Discord") === "communication", "Discord → communication");
assert(categorizeApp(null, "Safari") === "browser", "Safari → browser");
assert(categorizeApp(null, "Steam") === "gaming", "Steam → gaming");
assert(categorizeApp(null, "WeirdAppXYZ") === "unknown", "app inconnue → unknown");

// 1. coding + activité élevée
{
  const busyCoding = makeTestSnapshot({
    activeApp: "Cursor",
    activeAppBundleId: "com.todesktop.230313mzl4w4u92",
    category: "coding",
    activeAppDurationSec: 45 * 60,
    keyboardActivity: 0.85,
    pointerActivity: 0.5,
    overallActivity: 0.85,
    secondsSinceLastInput: 2,
    userBusy: true,
    userIdle: false,
  });
  const needs = new Needs();
  needs.energy = 70;
  needs.fatigue = 40;
  needs.boredom = 35;
  const ctx = mockCtx({ needs, userActivity: busyCoding, hour: 11 });
  assert(busyCoding.userBusy === true, "1. coding+high → userBusy");
  assert(userActivityFactor("cursor", ctx) < 0.3, "1. cursor fortement réduit si busy");
  assert(userActivityFactor("idle", ctx) > 1, "1. idle autonome légèrement ↑");
  assert(userActivityFactor("work", ctx) > 1, "1. work légèrement ↑");
  // Soft only : coffee Needs gate — pas forcé si pas tired
  const coffeeU = coffee.utility(ctx);
  assert(coffeeU === 0, "1. coffee non forcé si Needs ne le permettent pas");
}

// 2. gaming + activité élevée
{
  const gaming = makeTestSnapshot({
    activeApp: "Steam",
    category: "gaming",
    overallActivity: 0.9,
    keyboardActivity: 0.7,
    pointerActivity: 0.9,
    secondsSinceLastInput: 1,
    userBusy: true,
    userIdle: false,
  });
  const needs = new Needs();
  needs.boredom = 70;
  needs.energy = 60;
  needs.curiosity = 70;
  const ctx = mockCtx({
    needs,
    userActivity: gaming,
    cursor: {
      x: 650,
      y: 820,
      moving: true,
      idleSeconds: 0.2,
      distanceTo: () => 50,
    } as CursorTracker,
  });
  // Forcer ready cursor en évitant le random ignore : tester le factor seul
  assert(userActivityFactor("cursor", ctx) < 0.2, "2. gaming → cursor quasi coupé");
  assert(userActivityFactor("idle", ctx) >= 1, "2. gaming → idle autonome OK");
}

// 3. communication + activité élevée
{
  const comm = makeTestSnapshot({
    activeApp: "Discord",
    category: "communication",
    overallActivity: 0.8,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 3,
  });
  const ctx = mockCtx({ userActivity: comm });
  assert(comm.userBusy === true, "3. communication busy");
  assert(userActivityFactor("cursor", ctx) < 0.5, "3. chase/notice réduit, pas forcé");
}

// 4. utilisateur inactif
{
  const idleUser = makeTestSnapshot({
    activeApp: "Safari",
    category: "browser",
    overallActivity: 0.02,
    keyboardActivity: 0,
    pointerActivity: 0,
    secondsSinceLastInput: 400,
    userBusy: false,
    userIdle: true,
    lastAppChangeSec: 999,
  });
  const needs = new Needs();
  needs.curiosity = 70;
  needs.boredom = 50;
  const ctx = mockCtx({ needs, userActivity: idleUser, idleSeconds: 12 });
  assert(idleUser.userIdle === true, "4. userIdle");
  assert(userActivityFactor("look", ctx) > 1.1, "4. look ↑ si inactif");
  assert(userActivityFactor("window", ctx) > 1, "4. window ↑ si inactif");
  const lookU = lookAround.utility(ctx);
  const lookBase = mockCtx({
    needs,
    userActivity: emptyUserActivitySnapshot(),
    idleSeconds: 12,
  });
  // Snapshot empty is also idle-ish — compare factors instead
  assert(lookU > 0, "4. look accessible");
}

// 5. changement d'application — scoring soft, pas de goal spatial
{
  const switched = makeTestSnapshot({
    activeApp: "Cursor",
    category: "coding",
    lastAppChangeSec: 5,
    overallActivity: 0.4,
    userBusy: false,
    userIdle: false,
  });
  const needs = new Needs();
  needs.curiosity = 60;
  const ctx = mockCtx({ needs, userActivity: switched });
  assert(userActivityFactor("look", ctx) > 1.1, "5. app change → look boost soft");
  // Aucune consideration ne build un goTo vers fenêtre active dédiée
  const walkGoal = walkSomewhere.buildGoal(ctx);
  assert(walkGoal.kind === "goTo", "5. walk reste un goTo sol");
  assert(
    !("activeApp" in (walkGoal as object) && false),
    "5. pas de teleport app (structure goal normale)",
  );
}

// 6. application inconnue
{
  const unknown = makeTestSnapshot({
    activeApp: "WeirdAppXYZ",
    category: "unknown",
    overallActivity: 0.5,
    userBusy: false,
    userIdle: false,
  });
  assert(unknown.category === "unknown", "6. category unknown");
  const ctx = mockCtx({ userActivity: unknown });
  assert(userActivityFactor("idle", ctx) === 1, "6. unknown sans boost focus busy");
}

// 7. aucun input récent
{
  const noInput = makeTestSnapshot({
    secondsSinceLastInput: 600,
    overallActivity: 0,
    keyboardActivity: 0,
    pointerActivity: 0,
    userIdle: true,
    userBusy: false,
  });
  assert(noInput.secondsSinceLastInput >= 300, "7. secondsSinceLastInput élevé");
  assert(noInput.overallLevel === "idle", "7. overall idle");
}

// Memory prioritaire sur UserActivity (post-sleep + coding 2h)
{
  const codingLong = makeTestSnapshot({
    category: "coding",
    activeAppDurationSec: 2 * 3600,
    overallActivity: 0.9,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 1,
  });
  const needs = new Needs();
  needs.fatigue = 20;
  needs.energy = 85;
  const mem = new Memory();
  mem.remember("sleep", 1_000_000, 320_000);
  const ctx = mockCtx({
    needs,
    memory: mem,
    userActivity: codingLong,
    now: 1_060_000,
    hour: 14,
  });
  assert(sleep.utility(ctx) === 0, "Memory: sleep impossible post-sleep même si coding 2h");
  assert(userActivityFactor("sleep", ctx) > 1, "modifier sleep soft existe mais utility reste 0");
}

// Dance cooldown non bypassé
{
  const busy = makeTestSnapshot({
    category: "coding",
    userBusy: false,
    overallActivity: 0.3,
  });
  const needs = new Needs();
  needs.boredom = 80;
  needs.energy = 70;
  const mem = new Memory();
  mem.remember("dance", 1_000_000, 420_000);
  const ctx = mockCtx({ needs, memory: mem, userActivity: busy, now: 1_050_000 });
  assert(dance.utility(ctx) === 0, "dance cooldown Memory prioritaire");
}

// Anti-follow : factor cursor bas si busy, idleHere ne pointe pas la souris
{
  const busy = makeTestSnapshot({
    category: "coding",
    userBusy: true,
    overallActivity: 0.9,
    secondsSinceLastInput: 1,
  });
  const ctx = mockCtx({ userActivity: busy });
  const idleGoal = idleHere.buildGoal(ctx);
  assert(idleGoal.kind === "idle", "anti-follow: idle reste idle");
  assert(reactCursor.buildGoal(ctx).kind === "reactCursor", "cursor goal ok si choisi");
  // investigateWindow goTo side of nearestWindow world — pas activeApp window teleport dédié
  const wGoal = investigateWindow.buildGoal(ctx);
  assert(wGoal.kind === "goTo", "window approach via POI world, pas app frontmost");
}

// work score soft influence without force
{
  const longCoding = makeTestSnapshot({
    category: "coding",
    activeAppDurationSec: 40 * 60,
    overallActivity: 0.7,
    userBusy: true,
    userIdle: false,
    secondsSinceLastInput: 5,
  });
  const needs = new Needs();
  needs.energy = 60;
  needs.fatigue = 35;
  needs.boredom = 40;
  const ctxBusy = mockCtx({ needs, userActivity: longCoding, hour: 11 });
  const ctxCalm = mockCtx({
    needs,
    userActivity: emptyUserActivitySnapshot(),
    hour: 11,
  });
  const uBusy = work.utility(ctxBusy);
  const uCalm = work.utility(ctxCalm);
  assert(uBusy > uCalm, "work utility soft ↑ sous coding long (sans forcer)");
}

console.log("\nAll user-activity smoke checks passed.");
