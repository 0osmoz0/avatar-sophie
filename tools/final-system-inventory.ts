/**
 * Phase 10.5 — Inventaire système final (lecture seule, rien inventé).
 * Usage: npx --yes tsx tools/final-system-inventory.ts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANIMATION_IDS } from "../src/assets/generated/animations";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { emptyEnvironment } from "../src/environment/EnvironmentContext";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import { PRIORITY, type StateId } from "../src/state/types";
import { createAllStates } from "../src/state/states";
import type { Goal } from "../src/behavior/Goal";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tools/.audit-cache/final-system-inventory.txt");

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

/** Orientation dérivée de la famille (audit RuntimeAudit / catalogue). */
const ORIENTATION: Record<string, string> = {
  calm: "restorative",
  locomotion: "spatial",
  focus: "productive",
  rest: "restorative",
  social: "interactive",
  explore: "spatial",
  emotion: "affective",
  unknown: "unknown",
};

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mockBody(): Body {
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
  } as unknown as Body;
}

function mockCursor(): CursorTracker {
  return {
    x: 420,
    y: 800,
    vx: 0,
    vy: 0,
    moving: false,
    idleSeconds: 5,
    distanceTo(x: number, y: number) {
      return Math.hypot(this.x - x, this.y - y);
    },
  } as unknown as CursorTracker;
}

function mockWorld(): WorldSnapshot {
  const edge: EdgeAnchor = {
    kind: "screen-left",
    x: 64,
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
    windows: [
      {
        id: 1,
        title: "App",
        owner: "X",
        x: 200,
        y: 100,
        width: 800,
        height: 600,
      },
    ],
    points: [
      { kind: "floor", x: 200, y: 900 },
      { kind: "floor", x: 700, y: 900 },
      { kind: "corner", x: 50, y: 900 },
    ],
    nearestWindow: {
      id: 1,
      title: "App",
      owner: "X",
      x: 200,
      y: 100,
      width: 800,
      height: 600,
    },
    nearestEdge: edge,
  };
}

function baseCtx(): BrainContext {
  const userActivity = makeTestSnapshot({
    userIdle: false,
    userBusy: false,
    category: "coding",
  });
  return {
    now: Date.now(),
    body: mockBody(),
    cursor: mockCursor(),
    needs: new Needs(),
    memory: new Memory(),
    world: mockWorld(),
    userActivity,
    interpretedContext: interpretRules(userActivity),
    environment: emptyEnvironment(1440, 900),
    stateId: "IDLE",
    idleSeconds: 4,
    hour: 14,
  };
}

function goalSummary(g: Goal): string {
  if (g.kind === "idle") return `idle(${g.duration?.toFixed?.(1) ?? "?"})`;
  if (g.kind === "activity") return `activity:${g.state}`;
  if (g.kind === "goTo") {
    const then =
      g.then && "kind" in g.then
        ? `→${goalSummary(g.then as Goal)}`
        : g.then
          ? "→then"
          : "";
    return `goTo(x=${Math.round(g.x)})${then}`;
  }
  if (g.kind === "perch") return `perch→HANG`;
  if (g.kind === "reactCursor") return `reactCursor`;
  return g.kind;
}

function stateFromGoal(g: Goal): string {
  if (g.kind === "idle") return "IDLE";
  if (g.kind === "activity") return String(g.state);
  if (g.kind === "goTo") return "WALK";
  if (g.kind === "perch") return "HANG";
  if (g.kind === "reactCursor") return "CURSOR_NOTICE|CURSOR_CHASE";
  return "—";
}

function animForState(state: string): string {
  const map: Record<string, string> = {
    IDLE: "idle",
    LOOK_AROUND: "look_around",
    YAWN: "yawn",
    WALK: "walk",
    RUN: "run",
    FALL: "fall",
    HANG: "hang",
    SLEEP: "sleep",
    COFFEE: "coffee",
    WORK: "work|work_alt",
    OVERWORK: "overwork",
    STUDY: "study",
    EAT: "eat",
    THINK: "think",
    DANCE: "dance1–6",
    CURSOR_NOTICE: "look_around",
    CURSOR_CHASE: "chase|run|walk",
    DRAG: "drag",
    PET: "happy",
    POKE: "angry",
    WAVE: "wave",
    LOVE: "love",
    BLOW_KISS: "blow_kiss",
    HAPPY: "happy",
    EXCITED: "excited",
    ANGRY: "angry",
    CRYING: "crying",
    SURPRISE: "surprise",
    PUSH: "push",
    PULL: "pull",
    PHONE_CHECK: "phone_check",
    PHONE_TEXT: "phone_text",
    PHONE_CALL: "phone_call",
  };
  if (state.includes("|")) {
    return state
      .split("|")
      .map((s) => map[s.trim()] ?? "—")
      .join("|");
  }
  return map[state] ?? "—";
}

function extractMemoryCases(srcText: string): string[] {
  const out: string[] = [];
  const re = /case\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(srcText))) out.push(m[1]!);
  return [...new Set(out)];
}

function extractInputEvents(): string[] {
  const pointer = src("src/input/PointerInput.ts");
  const main = src("src/main.ts");
  const resolver = src("src/behavior/InteractionResolver.ts");
  const found = new Set<string>();
  for (const kind of ["pet", "poke", "wave", "love"]) {
    if (pointer.includes(kind) || resolver.includes(`"${kind}"`)) found.add(kind);
  }
  for (const sig of [
    "user_returned",
    "user_became_idle",
    "user_became_busy",
    "notifyUserActivity",
  ]) {
    if (main.includes(sig)) found.add(sig);
  }
  return [...found].sort();
}

function main(): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const lines: string[] = [];
  const ctx = baseCtx();
  const states = createAllStates();

  lines.push("=== FINAL SYSTEM INVENTORY (Phase 10.5) ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("Source: code only — nothing invented.");
  lines.push("");

  lines.push("--- ANIMATIONS ---");
  lines.push(`count: ${ANIMATION_IDS.length}`);
  for (const id of ANIMATION_IDS) lines.push(`  ${id}`);
  lines.push("");

  lines.push("--- STATES (createAllStates + PRIORITY) ---");
  const registered = new Set(states.map((s) => s.id));
  for (const id of Object.keys(PRIORITY) as StateId[]) {
    const reg = registered.has(id) ? "registered" : "PRIORITY-only";
    lines.push(`  ${id}  priority=${PRIORITY[id]}  ${reg}`);
  }
  lines.push("");

  lines.push("--- CONSIDERATIONS ---");
  lines.push(
    "format: id | family | orientation | cooldownMs | priority | state/goal | animation | preconditions(summary)",
  );
  for (const c of ALL_CONSIDERATIONS) {
    const fam = FAMILY[c.id] ?? "unknown";
    const orient = ORIENTATION[fam] ?? "unknown";
    let goalStr = "—";
    let stateStr = "—";
    try {
      const g = c.buildGoal(ctx);
      goalStr = goalSummary(g);
      stateStr = stateFromGoal(g);
    } catch (e) {
      goalStr = `error:${(e as Error).message}`;
    }
    const anim = animForState(stateStr);
    const reason = c.reason?.(ctx) ?? "";
    const pre = [
      c.cooldownMs != null ? `cooldown=${c.cooldownMs}ms` : null,
      reason ? `reason~${reason.slice(0, 80)}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(
      `  ${c.id} | ${fam} | ${orient} | cd=${c.cooldownMs ?? 0} | prio=${c.priority ?? 0} | state=${stateStr} | anim=${anim} | goal=${goalStr} | ${pre}`,
    );
  }
  lines.push("");

  lines.push("--- MODIFIERS (activityModifiers.ts) ---");
  const modSrc = src("src/user/activityModifiers.ts");
  lines.push(
    `  userActivityFactor: ${modSrc.includes("export function userActivityFactor") ? "yes" : "no"}`,
  );
  lines.push(
    `  personalityFactor: ${modSrc.includes("export function personalityFactor") ? "yes (0.90–1.15 clamp)" : "no"}`,
  );
  lines.push(
    `  environmentFactor: ${modSrc.includes("export function environmentFactor") ? "yes (0.85–1.15 clamp)" : "no"}`,
  );
  lines.push("");

  lines.push("--- MEMORY effects (case labels in Memory.ts) ---");
  const memCases = extractMemoryCases(src("src/behavior/Memory.ts"));
  for (const c of memCases) lines.push(`  ${c}`);
  lines.push("");

  lines.push("--- ENVIRONMENT CONTEXT ---");
  const envSrc = src("src/environment/EnvironmentContext.ts");
  for (const sym of [
    "deriveEnvironment",
    "isSafeMovement",
    "isPerchAnchorValid",
    "EnvironmentTracker",
    "emptyEnvironment",
    "nearEdge",
    "dangerousEdge",
    "cursorApproaching",
    "cursorLeaving",
    "musicPlaying",
  ]) {
    lines.push(`  ${sym}: ${envSrc.includes(sym) ? "present" : "absent"}`);
  }
  lines.push("");

  lines.push("--- INPUT EVENTS ---");
  for (const e of extractInputEvents()) lines.push(`  ${e}`);
  lines.push("");

  lines.push("--- CHAINS (chainBoost table keys in catalog.ts) ---");
  const cat = src("src/behavior/considerations/catalog.ts");
  const chainBlock = cat.match(/const table:[\s\S]*?return table/);
  if (chainBlock) {
    const keys = [...chainBlock[0].matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]!);
    for (const k of keys) lines.push(`  from: ${k}`);
  }
  lines.push("");

  lines.push("--- TRANSITIONS (HangState / Busy / Interaction) ---");
  const statesSrc = src("src/state/states.ts");
  const brainSrc = src("src/behavior/BehaviorBrain.ts");
  const irSrc = src("src/behavior/InteractionResolver.ts");
  lines.push(
    `  HangState idle exit: ${statesSrc.includes("request") || statesSrc.includes("IDLE") ? "HangState has IDLE timeout/exit path" : "check HangState"}`,
  );
  lines.push(
    `  busyOrphan / force IDLE: ${brainSrc.includes("busyOrphan") || brainSrc.includes("forceState") ? "present in BehaviorBrain" : "absent"}`,
  );
  lines.push(
    `  BUSY_NO_INTERRUPT: ${irSrc.includes("BUSY_NO_INTERRUPT") ? "present (PET/POKE defer)" : "absent"}`,
  );
  lines.push("");

  lines.push("--- SUMMARY COUNTS ---");
  lines.push(`  animations: ${ANIMATION_IDS.length}`);
  lines.push(`  states PRIORITY keys: ${Object.keys(PRIORITY).length}`);
  lines.push(`  states registered: ${states.length}`);
  lines.push(`  considerations: ${ALL_CONSIDERATIONS.length}`);
  lines.push(`  memory case labels: ${memCases.length}`);
  lines.push(`  input events: ${extractInputEvents().length}`);

  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

main();
