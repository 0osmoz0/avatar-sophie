/**
 * Smoke test local du scoring BehaviorBrain (sans UI).
 * Usage: npx --yes tsx tools/brain-smoke.ts
 */

import { Needs } from "../src/behavior/Needs";
import { Memory } from "../src/behavior/Memory";
import {
  sleep,
  dance,
  walkSomewhere,
  work,
  investigateWindow,
  yawn,
  coffee,
  reactCursor,
  angry,
  excited,
  crying,
  blowKiss,
  happy,
} from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { emptyEnvironment } from "../src/environment/EnvironmentContext";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import type { Goal } from "../src/behavior/Goal";
import { emptyUserActivitySnapshot, makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";

function mockCtx(partial: Partial<BrainContext> & { needs: Needs }): BrainContext {
  const memory = partial.memory ?? new Memory();
  const world = (partial.world ?? {
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
  }) as WorldSnapshot;

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
    world,
    userActivity,
    environment: emptyEnvironment(),
    interpretedContext: partial.interpretedContext ?? interpretRules(userActivity),
    stateId: partial.stateId ?? "IDLE",
    idleSeconds: partial.idleSeconds ?? 12,
    hour: partial.hour ?? 14,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok — ${msg}`);
}

function chainLabels(goal: Goal): string[] {
  const out = [goal.label ?? goal.kind];
  let g: Goal | undefined = goal.then;
  while (g) {
    out.push(g.label ?? g.kind);
    g = g.then;
  }
  return out;
}

const tired = new Needs();
tired.fatigue = 82;
tired.energy = 22;
tired.boredom = 15;
tired.curiosity = 40;
const ctxTired = mockCtx({ needs: tired, hour: 23 });
assert(sleep.utility(ctxTired) > 0.7, "SLEEP fort si fatigue↑ energy↓");
assert((sleep.reason?.(ctxTired) ?? "").includes("fatigue"), "reason sleep mentionne fatigue");

const playful = new Needs();
playful.fatigue = 15;
playful.energy = 70;
playful.boredom = 75;
playful.curiosity = 80;
const ctxPlay = mockCtx({
  needs: playful,
  idleSeconds: 10,
  world: {
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
  } as WorldSnapshot,
});
assert(walkSomewhere.utility(ctxPlay) > 0.25, "WALK compétitif si boredom↑");
assert(investigateWindow.utility(ctxPlay) > 0.2, "WINDOW possible si curiosity↑ + fenêtre");
assert(dance.utility(ctxPlay) > 0.6, "DANCE fort si boredom↑ energy OK");
assert(sleep.utility(ctxPlay) === 0, "SLEEP inéligible si peu fatiguée de jour");

const afterSleep = new Needs();
afterSleep.fatigue = 10;
afterSleep.energy = 90;
const mem = new Memory();
mem.remember("sleep", 1_000_000, 320_000);
const ctxPostSleep = mockCtx({ needs: afterSleep, memory: mem, now: 1_010_000, hour: 2 });
assert(sleep.utility(ctxPostSleep) === 0, "SLEEP impossible juste après sleep (cooldown)");

const afterDance = new Needs();
afterDance.boredom = 80;
afterDance.energy = 60;
const memDance = new Memory();
memDance.remember("dance", 1_000_000, 420_000);
const ctxPostDance = mockCtx({ needs: afterDance, memory: memDance, now: 1_050_000 });
assert(dance.utility(ctxPostDance) === 0, "DANCE en cooldown long");

const workNeeds = new Needs();
workNeeds.fatigue = 45;
workNeeds.energy = 60;
workNeeds.boredom = 40;
const ctxWork = mockCtx({ needs: workNeeds, hour: 11 });
const workGoal = work.buildGoal(ctxWork);
assert(
  chainLabels(workGoal).join("→") === "work→yawn→coffee",
  `chaîne work = ${chainLabels(workGoal).join("→")}`,
);

const yawnGate = workGoal.then?.gate;
assert(!!yawnGate, "yawn a un gate");
const fresh = new Needs();
fresh.fatigue = 20;
fresh.energy = 80;
const ctxFresh = mockCtx({ needs: fresh, hour: 11 });
assert(yawnGate!(ctxFresh) === false, "gate YAWN abandonne si plus fatiguée");

const coffeeGate = workGoal.then?.then?.gate;
assert(!!coffeeGate, "coffee a un gate");
const mid = new Needs();
mid.fatigue = 60;
mid.energy = 35;
const ctxMid = mockCtx({ needs: mid, hour: 11, memory: new Memory() });
assert(coffeeGate!(ctxMid) === true, "gate COFFEE OK si encore fatiguée");
assert(yawn.utility(ctxTired) > 0.3, "YAWN scorée si tired");
assert(coffee.utility(ctxTired) > 0.2, "COFFEE scorée si tired");

// --- Phase 2 : cursor + émotions ---
const cursorNeeds = new Needs();
cursorNeeds.curiosity = 75;
cursorNeeds.social = 60;
cursorNeeds.energy = 70;
cursorNeeds.boredom = 40;
const ctxCursorNear = mockCtx({
  needs: cursorNeeds,
  cursor: {
    x: 650,
    y: 100,
    moving: true,
    idleSeconds: 0,
    distanceTo: () => 80,
  } as CursorTracker,
});
const cursorU = reactCursor.utility(ctxCursorNear);
assert(cursorU > 0.15, `CURSOR scorée si proche+moving (u=${cursorU.toFixed(2)})`);
assert(
  (reactCursor.reason?.(ctxCursorNear) ?? "").includes("cursorNearby"),
  "reason cursor mentionne cursorNearby",
);
const cursorGoal = reactCursor.buildGoal(ctxCursorNear);
assert(cursorGoal.kind === "reactCursor", "cursor buildGoal reactCursor");
assert(
  cursorGoal.kind === "reactCursor" && cursorGoal.mode === "chase",
  "cursor chase déterministe si curious+moving+proche",
);

const focusUser = makeTestSnapshot({
  category: "coding",
  overallActivity: 0.9,
  userBusy: true,
  userIdle: false,
  secondsSinceLastInput: 1,
});
const ctxFocus = mockCtx({
  needs: cursorNeeds,
  userActivity: focusUser,
  environment: emptyEnvironment(),
  interpretedContext: interpretRules(focusUser),
  cursor: {
    x: 650,
    y: 100,
    moving: true,
    idleSeconds: 0,
    distanceTo: () => 80,
  } as CursorTracker,
});
assert(
  reactCursor.utility(ctxFocus) < cursorU * 0.5,
  "CURSOR fortement réduit en focused_work",
);

const angryNeeds = new Needs();
angryNeeds.affection = 20;
angryNeeds.boredom = 70;
angryNeeds.energy = 60;
const ctxAngry = mockCtx({ needs: angryNeeds });
assert(angry.utility(ctxAngry) > 0.2, "ANGRY si lowAffection+boredom");
assert((angry.reason?.(ctxAngry) ?? "").includes("frustration"), "reason angry frustration");

const memInt = new Memory();
memInt.remember("interrupted", 1_000_000);
const ctxInterrupted = mockCtx({
  needs: new Needs(),
  memory: memInt,
  now: 1_001_000,
});
assert(angry.utility(ctxInterrupted) > 0.3, "ANGRY après interrupted");

const excitedNeeds = new Needs();
excitedNeeds.boredom = 70;
excitedNeeds.energy = 65;
excitedNeeds.curiosity = 70;
excitedNeeds.fatigue = 10;
assert(excitedNeeds.mood === "playful", "mood playful prérequis excited");
const ctxExcited = mockCtx({ needs: excitedNeeds });
assert(excited.utility(ctxExcited) > 0.25, "EXCITED si playful+curious");
assert((excited.reason?.(ctxExcited) ?? "").includes("playful"), "reason excited playful");

const cryNeeds = new Needs();
cryNeeds.fatigue = 90;
cryNeeds.energy = 10;
cryNeeds.affection = 20;
const ctxCry = mockCtx({ needs: cryNeeds });
assert(crying.utility(ctxCry) > 0.4, "CRYING si exhausted+lowAffection");

const kissNeeds = new Needs();
kissNeeds.affection = 80;
kissNeeds.social = 60;
const memKiss = new Memory();
memKiss.remember("pet", 1_000_000);
const ctxKiss = mockCtx({ needs: kissNeeds, memory: memKiss, now: 1_001_000 });
assert(blowKiss.utility(ctxKiss) > 0.2, "BLOW_KISS après pet + affection haute");
assert(happy.utility(ctxKiss) > 0.15, "HAPPY lingering après pet");

assert(angry.utility(ctxPlay) === 0, "ANGRY inéligible sans cause");
assert(crying.utility(ctxPlay) === 0, "CRYING inéligible si playful OK");

console.log("\nAll brain smoke checks passed.");
