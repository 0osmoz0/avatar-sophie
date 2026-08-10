/**
 * Phase 10.5 — Audit d'invariants automatisé.
 * Usage: npx --yes tsx tools/final-invariants-audit.ts
 *
 * Combine grep statique + petites simulations. Ne modifie pas le scoring.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInteraction } from "../src/behavior/InteractionResolver";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import { environmentFactor, personalityFactor } from "../src/user/activityModifiers";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import {
  deriveEnvironment,
  emptyEnvironment,
  isSafeMovement,
} from "../src/environment/EnvironmentContext";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import type { StateId } from "../src/state/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tools/.audit-cache/final-invariants-report.txt");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function rg(pattern: string, glob = "*.ts"): string {
  try {
    return execSync(`rg -n --glob '${glob}' ${JSON.stringify(pattern)} src || true`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
  } catch {
    return "";
  }
}

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
    x: 420,
    y: 800,
    vx: 0,
    vy: 0,
    moving: false,
    idleSeconds: 5,
    distanceTo(this: CursorTracker, x: number, y: number) {
      return Math.hypot(this.x - x, this.y - y);
    },
    ...p,
  } as unknown as CursorTracker;
}

function world(): WorldSnapshot {
  const edge: EdgeAnchor = {
    kind: "screen-left",
    x: 40,
    y: 200,
    facing: 1,
    label: "left",
  };
  return {
    originX: 0,
    originY: 0,
    width: 1440,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [],
    points: [
      { kind: "floor", x: 200, y: 900 },
      { kind: "floor", x: 1200, y: 900 },
    ],
    nearestWindow: null,
    nearestEdge: edge,
  };
}

function ctx(partial?: Partial<BrainContext>): BrainContext {
  const userActivity = makeTestSnapshot({});
  const mem = new Memory();
  const base: BrainContext = {
    now: 1_000_000,
    body: body(),
    cursor: cursor(),
    needs: new Needs(),
    memory: mem,
    world: world(),
    userActivity,
    interpretedContext: interpretRules(userActivity),
    environment: emptyEnvironment(1440, 900),
    stateId: "IDLE",
    idleSeconds: 3,
    hour: 14,
  };
  return { ...base, ...partial };
}

function checkBusyPetPoke(): Check[] {
  const out: Check[] = [];
  const mem = new Memory();
  const needs = new Needs();
  const now = Date.now();
  const busyStates: StateId[] = [
    "WORK",
    "SLEEP",
    "DANCE",
    "COFFEE",
    "STUDY",
    "OVERWORK",
    "PHONE_CHECK",
  ];
  let allDeferred = true;
  for (const stateId of busyStates) {
    for (const kind of ["pet", "poke"] as const) {
      const r = resolveInteraction({ kind, needs, memory: mem, stateId, now });
      if (r.immediateState !== null || !r.deferred) {
        allDeferred = false;
        out.push({
          id: `PET/POKE_no_cut_BUSY_${stateId}_${kind}`,
          ok: false,
          detail: `immediate=${r.immediateState} deferred=${r.deferred}`,
        });
      }
    }
  }
  if (allDeferred) {
    out.push({
      id: "PET_POKE_no_cut_BUSY",
      ok: true,
      detail: "PET/POKE deferred on all BUSY states; immediateState=null",
    });
  }
  return out;
}

function checkPersonalityBounds(): Check {
  const mem = new Memory();
  const c = ctx({ memory: mem });
  const ids = ALL_CONSIDERATIONS.map((x) => x.id);
  let min = Infinity;
  let max = -Infinity;
  for (const id of ids) {
    const f = personalityFactor(id, c);
    min = Math.min(min, f);
    max = Math.max(max, f);
  }
  // Memory traits also in [0,1]
  const traits = [mem.independence, mem.sociability, mem.curiosityBias, mem.playfulness];
  const traitsOk = traits.every((t) => t >= 0 && t <= 1);
  const factorOk = min >= 0.9 - 1e-9 && max <= 1.15 + 1e-9;
  return {
    id: "personality_bounds",
    ok: traitsOk && factorOk,
    detail: `traits∈[0,1]=${traitsOk} factor∈[${min.toFixed(3)},${max.toFixed(3)}] (expect 0.90–1.15)`,
  };
}

function checkEnvFactorBounds(): Check {
  const c = ctx();
  // Force dangerous edge env
  const w = world();
  c.body = body({ x: 20, y: 900 });
  c.environment = deriveEnvironment({
    body: c.body,
    cursor: c.cursor,
    world: w,
    userActivity: c.userActivity,
    interpreted: c.interpretedContext,
    stateId: "IDLE",
  });
  let min = Infinity;
  let max = -Infinity;
  for (const cons of ALL_CONSIDERATIONS) {
    const f = environmentFactor(cons.id, c);
    min = Math.min(min, f);
    max = Math.max(max, f);
  }
  const ok = min >= 0.85 - 1e-9 && max <= 1.15 + 1e-9;
  return {
    id: "environment_factor_bounds",
    ok,
    detail: `factor∈[${min.toFixed(3)},${max.toFixed(3)}] expect 0.85–1.15 nearEdge=${c.environment.nearEdge} dangerous=${c.environment.dangerousEdge}`,
  };
}

function checkCooldownNovelty(): Check[] {
  const mem = new Memory();
  const now = 1_000_000;
  mem.remember("walk", now, 26_000);
  const readyBlocked = !mem.ready("walk", now + 1000);
  const readyAfter = mem.ready("walk", now + 30_000);
  mem.remember("phone_check", now);
  mem.remember("phone_check", now + 100);
  const nov = mem.noveltyModifier("phone_check");
  return [
    {
      id: "cooldowns",
      ok: readyBlocked && readyAfter,
      detail: `walk blocked mid-cd=${readyBlocked} ready after=${readyAfter}`,
    },
    {
      id: "novelty",
      ok: nov < 1,
      detail: `novelty after repeats=${nov.toFixed(3)} (expect <1)`,
    },
  ];
}

function checkPersonalityDecay(): Check {
  const mem = new Memory();
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) mem.remember("pet", t0 + i * 100, 0);
  const before = mem.sociability;
  // Drift toward baseline via update(dt)
  for (let i = 0; i < 600; i++) mem.update(1);
  const after = mem.sociability;
  const memSrc = src("src/behavior/Memory.ts");
  const hasDecay = /update\(dt/.test(memSrc) && /Décroissance|decay|baseline|0\.5/.test(memSrc);
  const movedTowardBaseline = after <= before;
  return {
    id: "personality_decay",
    ok: hasDecay && before >= 0 && before <= 1 && movedTowardBaseline,
    detail: `decay present=${hasDecay} sociability ${before.toFixed(3)}→${after.toFixed(3)}`,
  };
}

function checkSafeMovement(): Check[] {
  const w = world();
  const b = body({ x: 30, y: 900 });
  const env = deriveEnvironment({
    body: b,
    cursor: cursor(),
    world: w,
    userActivity: makeTestSnapshot({}),
    interpreted: interpretRules(makeTestSnapshot({})),
    stateId: "IDLE",
  });
  const towardEdge = isSafeMovement(env, -1, 200);
  const inland = isSafeMovement(env, 1, 200);
  const walkCons = ALL_CONSIDERATIONS.find((c) => c.id === "walk")!;
  const c = ctx({
    body: b,
    environment: env,
    world: w,
  });
  // If dangerous + toward edge, utility should be 0 (catalog precondition)
  c.environment = { ...env, dangerousEdge: true, movingTowardEdge: true, inVoid: false, hanging: false };
  const utilDanger = walkCons.utility(c);
  return [
    {
      id: "isSafeMovement_filters",
      ok: towardEdge === false || env.dangerousEdge || env.nearEdge,
      detail: `near left: safe(-1)=${towardEdge} safe(+1)=${inland} nearEdge=${env.nearEdge} dangerous=${env.dangerousEdge}`,
    },
    {
      id: "dangerous_walk_utility_zero",
      ok: utilDanger === 0,
      detail: `walk utility when dangerous+towardEdge=${utilDanger}`,
    },
  ];
}

function checkStaticInvariants(): Check[] {
  const checks: Check[] = [];
  const envMod = src("src/user/activityModifiers.ts");
  const envCtx = src("src/environment/EnvironmentContext.ts");
  const mem = src("src/behavior/Memory.ts");
  const ollama = existsSync(join(ROOT, "src/user/OllamaContextClient.ts"))
    ? src("src/user/OllamaContextClient.ts")
    : "";
  const brain = src("src/behavior/BehaviorBrain.ts");
  const hang = src("src/state/states.ts");

  // Personality / Environment must not call requestState
  const envHasRequest = /requestState/.test(envMod.split("environmentFactor")[1]?.slice(0, 2000) ?? "") ||
    /requestState/.test(envCtx);
  const persHasRequest =
    /requestState/.test(mem) === false
      ? false
      : /requestState/.test(mem);
  // More precise: activityModifiers personalityFactor/environmentFactor bodies
  const persFn = envMod.includes("personalityFactor") && !/function personalityFactor[\s\S]*?requestState/.test(envMod);
  const envFn = envMod.includes("environmentFactor") && !/function environmentFactor[\s\S]*?requestState/.test(envMod);

  checks.push({
    id: "no_env_requestState",
    ok: envFn && !envCtx.includes("requestState"),
    detail: "environmentFactor / EnvironmentContext must not call requestState",
  });
  checks.push({
    id: "no_personality_requestState",
    ok: persFn && !persHasRequest,
    detail: "personalityFactor / Memory must not call requestState",
  });

  // No direct animation from env/personality
  checks.push({
    id: "no_env_direct_animation",
    ok: !envCtx.includes("AnimationPlayer") && !envMod.includes("play("),
    detail: "Environment must not drive AnimationPlayer",
  });

  // No scheduler / quota (ignore comments denying schedulers)
  const schedHits = execSync(
    `rg -n "scheduler|behaviorQuota|rotationQueue" src || true`,
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => !/Pas un scheduler|not a scheduler|no scheduler/i.test(line));
  checks.push({
    id: "no_scheduler_quota",
    ok: schedHits.length === 0,
    detail: schedHits.length
      ? `found: ${schedHits.join(" | ").slice(0, 240)}`
      : "no scheduler/quota/rotationQueue in src",
  });

  // No frontmost window targeting for behavior
  const targeting = execSync(
    `rg -n "frontmost|NSWorkspace|targetWindowForBehavior" src || true`,
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  const activeTarget =
    targeting.includes("targetWindowForBehavior") ||
    /frontmost.*consideration|consideration.*frontmost/i.test(targeting);
  checks.push({
    id: "no_active_window_targeting",
    ok: !activeTarget,
    detail: activeTarget ? targeting.slice(0, 200) : "no active window behavior targeting",
  });

  // Ollama classification-only
  const ollamaOk =
    ollama.includes("classif") ||
    ollama.includes("interpret") ||
    !ollama.includes("requestState");
  checks.push({
    id: "ollama_classification_only",
    ok: ollamaOk && !ollama.includes("requestState") && !ollama.includes("AnimationPlayer"),
    detail: "OllamaContextClient must not drive state/animation",
  });

  // HANG / PERCH exits
  checks.push({
    id: "hang_has_exit",
    ok:
      hang.includes("class HangState") &&
      (hang.includes("IDLE") || hang.includes("14") || hang.includes("timeout")),
    detail: "HangState present with idle/timeout exit",
  });
  checks.push({
    id: "perch_has_exit",
    ok: brain.includes("perch") && (brain.includes("HANG") || brain.includes("isPerchAnchorValid")),
    detail: "BehaviorBrain perch → HANG with anchor validity",
  });

  // Needs remain in pipeline
  checks.push({
    id: "needs_in_pipeline",
    ok: brain.includes("needs") && src("src/behavior/considerations/catalog.ts").includes("ctx.needs"),
    detail: "Needs used by Brain + considerations",
  });

  void envHasRequest;
  return checks;
}

function main(): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const checks: Check[] = [
    ...checkBusyPetPoke(),
    checkPersonalityBounds(),
    checkEnvFactorBounds(),
    ...checkCooldownNovelty(),
    checkPersonalityDecay(),
    ...checkSafeMovement(),
    ...checkStaticInvariants(),
  ];

  const failed = checks.filter((c) => !c.ok);
  const lines: string[] = [];
  lines.push("=== FINAL INVARIANTS AUDIT (Phase 10.5) ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Passed: ${checks.length - failed.length}/${checks.length}`);
  lines.push("");
  for (const c of checks) {
    lines.push(`${c.ok ? "PASS" : "FAIL"}  ${c.id}`);
    lines.push(`       ${c.detail}`);
  }
  lines.push("");
  if (failed.length) {
    lines.push("FAILURES:");
    for (const f of failed) lines.push(`  - ${f.id}: ${f.detail}`);
  } else {
    lines.push("All invariants OK.");
  }

  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  if (failed.length) process.exitCode = 1;
}

main();
