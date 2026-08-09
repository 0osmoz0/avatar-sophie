/**
 * Validation complète — interprétation contexte → utilities Brain.
 * Usage: npx --yes tsx tools/context-validation.ts
 */

import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
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
import {
  OllamaContextClient,
  __test as ollamaTest,
} from "../src/user/OllamaContextClient";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { formatContextHint } from "../src/user/InterpretedUserContext";
import { BrainDebug } from "../src/behavior/BrainDebug";

const FACTOR_IDS = [
  "cursor",
  "dance",
  "walk",
  "look",
  "window",
  "perch",
  "work",
  "study",
  "think",
  "idle",
] as const;

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
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 10,
    hour: partial.hour ?? 14,
  };
}

function factorsFor(ctx: BrainContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of FACTOR_IDS) out[id] = userActivityFactor(id, ctx);
  return out;
}

function printFactors(label: string, f: Record<string, number>): void {
  console.log(`\n--- ${label} ---`);
  for (const id of FACTOR_IDS) {
    console.log(`  ${id.padEnd(8)} ×${f[id]!.toFixed(3)}`);
  }
}

console.log("=== 1. Scénarios d'interprétation ===\n");

// focused_work
const codingSnap = makeTestSnapshot({
  activeApp: "Cursor",
  activeAppBundleId: "com.todesktop.230313mzl4w4u92",
  category: "coding",
  activeAppDurationSec: 45 * 60,
  keyboardActivity: 0.9,
  pointerActivity: 0.5,
  overallActivity: 0.85,
  secondsSinceLastInput: 1,
  userBusy: true,
  userIdle: false,
});
const focused = interpretRules(codingSnap);
assert(focused.mode === "focused_work", "coding busy → focused_work");
assert(focused.disturbanceTolerance === "low", "focused_work → disturb=low");
assert(focused.source === "rules", "focused_work source=rules");
assert(focused.autonomyBias >= 0.8, "focused_work autonomy↑");
console.log(`[Context] ${formatContextHint(focused)}`);
console.log(
  `[Context] mode=${focused.mode} conf=${focused.confidence.toFixed(2)} source=${focused.source} ` +
    `disturb=${focused.disturbanceTolerance} autonomy=${focused.autonomyBias.toFixed(2)}`,
);

// gaming
const gamingSnap = makeTestSnapshot({
  category: "gaming",
  overallActivity: 0.75,
  pointerActivity: 0.8,
  userBusy: true,
  userIdle: false,
  secondsSinceLastInput: 0.4,
});
const gaming = interpretRules(gamingSnap);
assert(gaming.mode === "gaming", "gaming → mode=gaming");
assert(gaming.disturbanceTolerance === "low", "gaming → disturb=low");
console.log(`[Context] ${formatContextHint(gaming)}`);

// media
const mediaSnap = makeTestSnapshot({
  category: "media",
  overallActivity: 0.2,
  pointerActivity: 0.15,
  userBusy: false,
  userIdle: false,
  secondsSinceLastInput: 40,
});
const media = interpretRules(mediaSnap);
assert(media.mode === "media_watching", "media faible/moyenne → media_watching");
assert(media.disturbanceTolerance === "medium", "media → disturb=medium");
console.log(`[Context] ${formatContextHint(media)}`);

// idle
const idleSnap = makeTestSnapshot({
  category: "unknown",
  overallActivity: 0.02,
  secondsSinceLastInput: 600,
  userBusy: false,
  userIdle: true,
});
const idle = interpretRules(idleSnap);
assert(idle.mode === "idle_away", "idle → idle_away");
assert(idle.disturbanceTolerance === "high", "idle → disturb=high");
assert(idle.socialOpenness > 0.5, "idle → socialOpenness↑");
console.log(`[Context] ${formatContextHint(idle)}`);

console.log("\n=== 2. Comparaison factors focused_work vs idle_away ===");
const needsBalanced = new Needs();
needsBalanced.energy = 70;
needsBalanced.fatigue = 25;
needsBalanced.boredom = 40;
needsBalanced.curiosity = 50;
needsBalanced.social = 45;

const ctxFocused = mockCtx({
  needs: needsBalanced,
  userActivity: codingSnap,
  interpretedContext: focused,
});
const ctxIdle = mockCtx({
  needs: needsBalanced,
  userActivity: idleSnap,
  interpretedContext: idle,
});
const fFocused = factorsFor(ctxFocused);
const fIdle = factorsFor(ctxIdle);
printFactors("focused_work", fFocused);
printFactors("idle_away", fIdle);

assert(fFocused.cursor! < 0.25, "focused: cursor fortement ↓");
assert(fFocused.dance! < 1, "focused: dance ↓");
assert(fFocused.walk! > 1 && fFocused.work! > 1 && fFocused.think! > 1, "focused: autonomie soft ↑");
assert(fIdle.look! > fFocused.look!, "idle look > focused look");
assert(fIdle.window! > fFocused.window!, "idle window > focused window");
assert(fIdle.perch! > fFocused.perch!, "idle perch > focused perch");
assert(fIdle.cursor! > fFocused.cursor!, "idle cursor > focused cursor (sans chase forcé)");
assert(fIdle.cursor! < 1.2, "idle cursor mild (pas chase forcé)");

const ctxGaming = mockCtx({ userActivity: gamingSnap, interpretedContext: gaming });
const fGaming = factorsFor(ctxGaming);
assert(fGaming.cursor! < 0.2, "gaming: cursor ↓↓");
assert(fGaming.dance! < 1, "gaming: dance ↓");

const ctxMedia = mockCtx({ userActivity: mediaSnap, interpretedContext: media });
const fMedia = factorsFor(ctxMedia);
assert(Math.abs(fMedia.cursor! - 0.7) < 0.01, "media: cursor neutre-léger (×0.7)");
assert(fMedia.walk! > 1 && fMedia.walk! < 1.2, "media: walk léger autonomyBias");

console.log("\n=== 3. Anti-Goal structurel ===");
{
  const srcMods = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/user/activityModifiers.ts", import.meta.url), "utf8"),
  );
  const srcInterp = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/user/LocalContextInterpreter.ts", import.meta.url), "utf8"),
  );
  const srcOllama = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/user/OllamaContextClient.ts", import.meta.url), "utf8"),
  );
  for (const [name, src] of [
    ["activityModifiers", srcMods],
    ["LocalContextInterpreter", srcInterp],
    ["OllamaContextClient", srcOllama],
  ] as const) {
    assert(!/suggestedGoal|suggestedAnimation/.test(src), `${name}: pas de suggestedGoal`);
    assert(!/requestState\s*\(/.test(src), `${name}: pas de requestState`);
    assert(!/buildGoal/.test(src), `${name}: pas de buildGoal`);
    assert(!/kind:\s*"(goTo|activity|reactCursor)"/.test(src), `${name}: pas de Goal littéral`);
  }
  // mode → Goal interdit dans modifiers (seulement factors)
  assert(
    !/if\s*\(.*mode\s*===.*\)\s*\{[^}]*return\s*\{[^}]*kind:/.test(srcMods),
    "modifiers: mode ne retourne pas de Goal",
  );

  for (const c of ALL_CONSIDERATIONS) {
    const goal = c.buildGoal(ctxFocused);
    const blob = JSON.stringify(goal);
    assert(
      !blob.includes("com.todesktop") && !blob.includes("activeApp"),
      `${c.id}: Goal sans app frontmost`,
    );
  }
}

console.log("\n=== 4. Priorités Needs / Memory / BUSY ===");

// Needs peut mettre utility à 0 malgré focused_work
{
  const rested = new Needs();
  rested.energy = 90;
  rested.fatigue = 5;
  rested.boredom = 10;
  const ctx = mockCtx({
    needs: rested,
    userActivity: codingSnap,
    interpretedContext: focused,
    hour: 14,
  });
  const sleep = ALL_CONSIDERATIONS.find((c) => c.id === "sleep")!;
  assert(sleep.utility(ctx) === 0, "Needs: sleep=0 si pas fatigué (focused_work n'impose pas)");
}

// focused_work n'empêche pas un vrai besoin de dormir
{
  const exhausted = new Needs();
  exhausted.energy = 10;
  exhausted.fatigue = 92;
  const mem = new Memory();
  const ctx = mockCtx({
    needs: exhausted,
    memory: mem,
    userActivity: codingSnap,
    interpretedContext: focused,
    hour: 23,
  });
  const sleep = ALL_CONSIDERATIONS.find((c) => c.id === "sleep")!;
  const u = sleep.utility(ctx);
  assert(u > 0.3, `focused_work n'empêche pas sleep si Needs fort (u=${u.toFixed(2)})`);
  console.log(`[Brain] sleep utility under focused_work + exhausted = ${u.toFixed(2)}`);
}

// Memory cooldown non contournable
{
  const playful = new Needs();
  playful.energy = 80;
  playful.boredom = 80;
  playful.fatigue = 10;
  const mem = new Memory();
  mem.remember("dance", 1_000_000, 300_000);
  const ctx = mockCtx({
    needs: playful,
    memory: mem,
    userActivity: idleSnap,
    interpretedContext: idle,
    now: 1_010_000,
  });
  const dance = ALL_CONSIDERATIONS.find((c) => c.id === "dance")!;
  assert(dance.utility(ctx) === 0, "Memory: cooldown dance non contournable par idle_away");
}

// gaming / idle ne forcent aucune anim (utilities gated restent 0)
{
  const flat = new Needs();
  flat.energy = 80;
  flat.fatigue = 10;
  flat.boredom = 10;
  flat.curiosity = 20;
  flat.social = 20;
  for (const [label, snap, interp] of [
    ["gaming", gamingSnap, gaming],
    ["idle_away", idleSnap, idle],
  ] as const) {
    const ctx = mockCtx({ needs: flat, userActivity: snap, interpretedContext: interp });
    const dance = ALL_CONSIDERATIONS.find((c) => c.id === "dance")!;
    const coffee = ALL_CONSIDERATIONS.find((c) => c.id === "coffee")!;
    assert(dance.utility(ctx) === 0, `${label}: pas d'anim dance obligatoire`);
    assert(coffee.utility(ctx) === 0, `${label}: pas de coffee obligatoire`);
  }
}

// BUSY_STATES protégés (structure)
{
  const brainSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/behavior/BehaviorBrain.ts", import.meta.url), "utf8"),
  );
  for (const s of ["WORK", "SLEEP", "DANCE", "COFFEE"]) {
    assert(brainSrc.includes(`"${s}"`), `BUSY_STATES inclut ${s}`);
  }
  assert(
    /BUSY_STATES\.has\(stateId\)\)\s*return false/.test(brainSrc.replace(/\s+/g, " ")),
    "canDecide refuse BUSY_STATES",
  );
}

console.log("\n=== 5. Ollama fallback ===");

// flag off
{
  const g = globalThis as { localStorage?: { getItem: (k: string) => string | null } };
  const prev = g.localStorage;
  g.localStorage = { getItem: () => null };
  assert(!OllamaContextClient.isEnabled(), "flag off → isEnabled=false");
  const interp = new LocalContextInterpreter();
  const out = interp.update(codingSnap, ["appChanged"]);
  assert(out.source === "rules", "flag off → source=rules");
  g.localStorage = prev;
}

// invalid JSON
assert(ollamaTest.parseClassification("nope") === null, "réponse invalide → discard");
assert(
  ollamaTest.parseClassification('{"mode":"nope","confidence":1,"disturbanceTolerance":"low","socialOpenness":0,"autonomyBias":1}') ===
    null,
  "mode invalide → discard",
);

// unavailable (flag on + fetch fail) → rules
{
  const g = globalThis as {
    localStorage?: { getItem: (k: string) => string | null };
    fetch?: typeof fetch;
  };
  const prevLs = g.localStorage;
  const prevFetch = g.fetch;
  g.localStorage = { getItem: (k) => (k === "sophieUseOllama" ? "1" : null) };
  assert(OllamaContextClient.isEnabled(), "flag on → isEnabled");
  g.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const client = new OllamaContextClient();
  const classified = await client.classify(codingSnap);
  assert(classified === null, "Ollama down → classify null");
  const interp = new LocalContextInterpreter();
  const out = interp.update(codingSnap, ["busyChanged"]);
  assert(out.source === "rules", "Ollama down → fallback rules");
  assert(out.mode === "focused_work", "fallback conserve mode rules");
  // wait microtask for async request to settle
  await new Promise((r) => setTimeout(r, 20));
  assert(interp.current.source === "rules", "après async fail → toujours rules");
  g.localStorage = prevLs;
  g.fetch = prevFetch;
}

// available mock → peut enrichir
{
  const g = globalThis as {
    localStorage?: { getItem: (k: string) => string | null };
    fetch?: typeof fetch;
  };
  const prevLs = g.localStorage;
  const prevFetch = g.fetch;
  g.localStorage = { getItem: (k) => (k === "sophieUseOllama" ? "1" : null) };
  g.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            mode: "focused_work",
            confidence: 0.95,
            disturbanceTolerance: "low",
            socialOpenness: 0.2,
            autonomyBias: 0.9,
            summary: "deep focus coding",
          }),
        },
      }),
    }) as Response;
  const interp = new LocalContextInterpreter();
  const sync = interp.update(codingSnap, ["appChanged"]);
  assert(sync.source === "rules", "sync immédiat = rules avant async");
  await new Promise((r) => setTimeout(r, 30));
  assert(interp.current.source === "ollama", "Ollama up → source=ollama");
  assert(interp.current.confidence >= 0.9, "Ollama affine confidence");
  assert(interp.current.mode === "focused_work", "Ollama mode compatible adopté");
  g.localStorage = prevLs;
  g.fetch = prevFetch;
}

console.log("\n=== 6. Debug reason strings ===");
{
  // Deterministic cursor: stub Math.random for utility path
  const realRandom = Math.random;
  Math.random = () => 0.99; // pass the 0.7 gate
  const walk = ALL_CONSIDERATIONS.find((c) => c.id === "walk")!;
  const reason = walk.reason?.(ctxFocused) ?? "";
  assert(reason.includes("focused_work") || reason.includes("context="), "reason inclut contexte");
  console.log(`[Brain] pick=walk reason=${reason}`);
  console.log(`[Brain] context short=${BrainDebug.formatContextShort(focused)}`);

  const look = ALL_CONSIDERATIONS.find((c) => c.id === "look")!;
  console.log(`[Brain] look reason focused: ${look.reason?.(ctxFocused)}`);
  console.log(`[Brain] look reason idle:    ${look.reason?.(ctxIdle)}`);
  Math.random = realRandom;
}

console.log("\n=== Rapport facteurs (delta idle − focused) ===");
for (const id of FACTOR_IDS) {
  const d = fIdle[id]! - fFocused[id]!;
  const sign = d > 0.001 ? "+" : d < -0.001 ? "" : "±";
  console.log(`  ${id.padEnd(8)} focused=${fFocused[id]!.toFixed(3)} idle=${fIdle[id]!.toFixed(3)} Δ=${sign}${d.toFixed(3)}`);
}

console.log("\nAll context validation checks passed.");
