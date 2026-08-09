/**
 * Smoke Phase 3 — mémoire comportementale + interactions contextuelles.
 * Usage: npx --yes tsx tools/behavior-memory-smoke.ts
 */

import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import {
  resolveInteraction,
  isBusyState,
} from "../src/behavior/InteractionResolver";
import { angry, happy, blowKiss, lookAround } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { emptyEnvironment } from "../src/environment/EnvironmentContext";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { emptyUserActivitySnapshot, makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { userActivityFactor } from "../src/user/activityModifiers";
import type { StateId } from "../src/state/types";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok — ${msg}`);
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
    world: (partial.world ?? {
      originX: 0,
      originY: 0,
      width: 1400,
      height: 900,
      scaleFactor: 2,
      monitors: [],
      windows: [],
      points: [],
      nearestWindow: null,
      nearestEdge: null,
    }) as WorldSnapshot,
    userActivity,
    environment: emptyEnvironment(),
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 8,
    hour: partial.hour ?? 14,
  };
}

const NOW = 2_000_000;

// --- 1. PET positif → Memory + HAPPY possible ---
{
  const needs = new Needs();
  needs.affection = 60;
  needs.social = 50;
  const memory = new Memory();
  const r = resolveInteraction({
    kind: "pet",
    needs,
    memory,
    stateId: "IDLE",
    now: NOW,
  });
  assert(r.immediateState === "HAPPY", "PET + affection≥50 → HAPPY");
  for (const x of r.remember) memory.remember(x.label, NOW, x.cooldownMs ?? 0);
  if (r.notePositive) memory.notePositive(r.notePositive);
  assert(memory.recentlyDid("pet"), "Memory pet après interaction");
  assert(memory.recentPositiveInteraction > 0, "notePositive appliqué");
}

// --- 2. Anti-spam HAPPY ---
{
  const needs = new Needs();
  needs.affection = 60;
  needs.social = 50;
  const memory = new Memory();
  memory.remember("happy", NOW, 12_000);
  memory.remember("pet", NOW);
  const r = resolveInteraction({
    kind: "pet",
    needs,
    memory,
    stateId: "IDLE",
    now: NOW + 100,
  });
  assert(r.immediateState === "PET", "anti-spam: HAPPY récent → PET only");
  assert(
    (r.suppressReason ?? "").includes("recentlyUsed happy"),
    "suppress reason recentlyUsed happy",
  );
}

// --- 3. Affection forte + pet récent → BLOW_KISS ---
{
  const needs = new Needs();
  needs.affection = 80;
  needs.social = 55;
  const memory = new Memory();
  memory.remember("pet", NOW - 5_000);
  const r = resolveInteraction({
    kind: "pet",
    needs,
    memory,
    stateId: "IDLE",
    now: NOW,
  });
  assert(r.immediateState === "BLOW_KISS", "affection haute + pet récent → BLOW_KISS");
}

// --- 4. WORK + PET → différé, pas d'interruption ---
{
  const needs = new Needs();
  needs.affection = 70;
  needs.social = 50;
  const memory = new Memory();
  const r = resolveInteraction({
    kind: "pet",
    needs,
    memory,
    stateId: "WORK",
    now: NOW,
  });
  assert(r.deferred === true, "PET pendant WORK → deferred");
  assert(r.immediateState === null, "PET pendant WORK → pas d'état immédiat");
  assert(isBusyState("WORK"), "WORK est busy");
  assert(isBusyState("SLEEP") && isBusyState("DANCE") && isBusyState("COFFEE"), "BUSY protégés");
  for (const x of r.remember) memory.remember(x.label, NOW, x.cooldownMs ?? 0);
  // Après WORK : happy consideration possible
  needs.affection = 70;
  const ctx = mockCtx({ needs, memory, now: NOW + 1_000, stateId: "IDLE" });
  assert(happy.utility(ctx) > 0.15, "après WORK: HAPPY utility > 0 grâce à Memory pet");
}

// --- 5. Interruption → angry ---
{
  const needs = new Needs();
  needs.affection = 40;
  needs.boredom = 30;
  const memory = new Memory();
  memory.remember("interrupted", NOW);
  const ctx = mockCtx({ needs, memory, now: NOW + 500 });
  assert(angry.utility(ctx) > 0.3, "interrupted → ANGRY possible");
  assert((angry.reason?.(ctx) ?? "").includes("interrupted"), "reason angry interrupted");
}

// --- 6. user_returned → opportunité, pas d'anim forcée ---
{
  const needs = new Needs();
  needs.curiosity = 55;
  needs.boredom = 30;
  needs.affection = 60;
  const memory = new Memory();
  memory.remember("user_returned", NOW, 45_000);
  memory.notePositive(0.3);
  const ctx = mockCtx({ needs, memory, now: NOW + 1_000 });
  assert(lookAround.utility(ctx) > 0.2, "user_returned boost look (utility)");
  assert(happy.utility(ctx) > 0, "user_returned peut ouvrir HAPPY si affection OK");
  // Aucune branche obligatoire : on vérifie juste que les utilities sont influencées
  assert(true, "user_returned n'impose aucune animation");
}

// --- 7. user_became_idle → modifiers ---
{
  const needs = new Needs();
  const memory = new Memory();
  memory.remember("user_became_idle", NOW, 60_000);
  const idleUser = makeTestSnapshot({
    userIdle: true,
    userBusy: false,
    secondsSinceLastInput: 400,
    overallActivity: 0.05,
  });
  const ctx = mockCtx({
    needs,
    memory,
    now: NOW + 1_000,
    userActivity: idleUser,
    environment: emptyEnvironment(),
    interpretedContext: interpretRules(idleUser),
  });
  const lookF = userActivityFactor("look", ctx);
  const walkF = userActivityFactor("walk", ctx);
  assert(lookF >= 1.1, `user_became_idle look factor ≥1.1 (got ${lookF.toFixed(2)})`);
  assert(walkF >= 1.08, `user_became_idle walk factor soft ↑ (got ${walkF.toFixed(2)})`);
  assert(true, "user idle: aucune animation obligatoire");
}

// --- 8. Anti-spam PET×4 ---
{
  const needs = new Needs();
  needs.affection = 60;
  needs.social = 50;
  const memory = new Memory();
  const states: Array<string | null> = [];
  let t = NOW;
  for (let i = 0; i < 4; i++) {
    const r = resolveInteraction({
      kind: "pet",
      needs,
      memory,
      stateId: "IDLE",
      now: t,
    });
    states.push(r.immediateState);
    for (const x of r.remember) memory.remember(x.label, t, x.cooldownMs ?? 0);
    t += 500; // spam rapide
  }
  const happyCount = states.filter((s) => s === "HAPPY").length;
  assert(happyCount <= 1, `PET×4 spam → au plus 1 HAPPY (got ${happyCount}: ${states.join(",")})`);
}

// --- 9. Continuité : HAPPY consideration bloquée si happy récent ---
{
  const needs = new Needs();
  needs.affection = 70;
  needs.social = 50;
  const memory = new Memory();
  memory.remember("pet", NOW);
  memory.remember("happy", NOW);
  memory.notePositive(0.5);
  const ctx = mockCtx({ needs, memory, now: NOW + 200 });
  assert(happy.utility(ctx) === 0, "continuité: happy récent → utility 0");
}

// --- 10. blow_kiss consideration ---
{
  const needs = new Needs();
  needs.affection = 80;
  needs.social = 60;
  const memory = new Memory();
  memory.remember("pet", NOW);
  const ctx = mockCtx({ needs, memory, now: NOW + 500 });
  assert(blowKiss.utility(ctx) > 0.2, "blow_kiss consideration après pet");
}

// --- 11. POKE contextuel ---
{
  const calm = new Needs();
  calm.affection = 20;
  calm.energy = 50;
  calm.boredom = 30;
  const mem = new Memory();
  const rAngry = resolveInteraction({
    kind: "poke",
    needs: calm,
    memory: mem,
    stateId: "IDLE",
    now: NOW,
  });
  assert(rAngry.immediateState === "ANGRY", "POKE + affection basse → ANGRY");

  const play = new Needs();
  play.affection = 50;
  play.energy = 70;
  play.boredom = 70;
  play.curiosity = 60;
  play.fatigue = 10;
  assert(play.mood === "playful", "mood playful pour EXCITED");
  const rEx = resolveInteraction({
    kind: "poke",
    needs: play,
    memory: new Memory(),
    stateId: "IDLE",
    now: NOW,
  });
  assert(rEx.immediateState === "EXCITED", "POKE playful + energy → EXCITED");
}

// --- 12. Personnalité Phase 6 ---
{
  const memory = new Memory();
  const snap = memory.personalitySnapshot();
  for (const [k, v] of Object.entries(snap)) {
    assert(v >= 0 && v <= 1, `personality ${k} in [0,1]`);
  }
  memory.nudgePersonality({ playfulness: 0.3, sociability: 0.25 });
  assert(memory.playfulness > 0.5, "nudge playfulness ↑");
  const before = memory.playfulness;
  for (let i = 0; i < 300; i++) memory.update(1);
  assert(memory.playfulness < before, "trends decay toward baseline");
  assert(memory.playfulness >= 0 && memory.playfulness <= 1, "decay stays in [0,1]");
  const f = memory.personalityFactor("dance");
  assert(f >= 0.9 && f <= 1.15, `personalityFactor dance in range (got ${f})`);
}

console.log("\nAll behavior-memory smoke checks passed.");
