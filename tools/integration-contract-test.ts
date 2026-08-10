/**
 * Phase 12 — Test du contrat d'intégration.
 *
 * Vérifie :
 *   external event → adapter → Memory/context → (Brain path)
 *   ET external event ≠ direct animation / state / goal
 *
 * Usage: npx --yes tsx tools/integration-contract-test.ts
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SophieEventBus } from "../src/integration/SophieEventBus";
import { attachSophieIntegration } from "../src/integration/SophieIntegration";
import { SophieAPI } from "../src/integration/SophieAPI";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import { BehaviorBrain } from "../src/behavior/BehaviorBrain";
import { StateMachine } from "../src/state/StateMachine";
import { IdleState, createAllStates } from "../src/state/states";
import type { StateId } from "../src/state/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tools/.audit-cache/integration-contract-report.txt");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok — ${msg}`);
}

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function main(): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const lines: string[] = [];
  lines.push("=== INTEGRATION CONTRACT TEST (Phase 12) ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  // --- Structural invariants ---
  const integrationSrc = src("src/integration/SophieIntegration.ts");
  const apiSrc = src("src/integration/SophieAPI.ts");
  assert(
    !/requestState|StateMachine\.request|AnimationPlayer|\.play\(/.test(
      integrationSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    ),
    "adapter source has no requestState / AnimationPlayer / play()",
  );
  assert(
    !/machine\.request|player\.play/.test(apiSrc),
    "SophieAPI does not call machine.request / player.play",
  );
  assert(
    integrationSrc.includes("memory.remember") &&
      integrationSrc.includes("notifyUserActivity"),
    "adapter writes Memory + notifyUserActivity",
  );

  // --- Runtime path ---
  const needs = new Needs();
  const states = createAllStates();
  const idle = states.find((s) => s.id === "IDLE") ?? new IdleState();
  const machine = new StateMachine(idle, states);
  const brain = new BehaviorBrain(machine, needs);
  const memory = brain.memory;

  let requestStateCalls = 0;
  const origRequest = machine.request.bind(machine);
  machine.request = ((id: StateId, force = false) => {
    requestStateCalls += 1;
    return origRequest(id, force);
  }) as typeof machine.request;

  const bus = new SophieEventBus();
  const observed: string[] = [];
  bus.subscribe("*", (e) => observed.push(e.type));

  const detach = attachSophieIntegration({
    bus,
    brain,
    memory,
    needs,
    getStateId: () => machine.currentId,
  });

  const stateBefore = machine.currentId;
  const goalBefore = brain.memory.lastBehavior();

  bus.emit({
    type: "user_returned",
    source: "external_project",
    timestamp: Date.now(),
  });
  assert(
    memory.recentWithin("user_returned", Date.now(), 45_000),
    "user_returned → Memory",
  );
  assert(requestStateCalls === 0, "user_returned ≠ requestState");
  assert(machine.currentId === stateBefore, "user_returned ≠ direct state change");
  assert(
    brain.memory.lastBehavior() === goalBefore ||
      brain.memory.lastBehavior() === "user_returned",
    "user_returned does not force a behavior goal animation",
  );

  bus.emit({ type: "pet", source: "external_project", timestamp: Date.now() });
  assert(memory.recentWithin("pet", Date.now(), 10_000), "pet → Memory");
  assert(requestStateCalls === 0, "pet via bus ≠ requestState");
  assert(machine.currentId === "IDLE", "pet via bus ≠ immediate PET state");
  assert(observed.includes("user_interaction"), "outbound user_interaction emitted");

  bus.emit({
    type: "user_idle",
    source: "external_project",
    timestamp: Date.now(),
  });
  assert(
    memory.recentWithin("user_became_idle", Date.now(), 60_000),
    "user_idle → user_became_idle Memory",
  );
  assert(requestStateCalls === 0, "user_idle ≠ requestState");

  bus.emit({
    type: "music_started",
    category: "music",
    source: "external_project",
  });
  assert(
    memory.recentWithin("music_started", Date.now(), 30_000),
    "music_started → Memory only (no fake musicPlaying env)",
  );
  assert(requestStateCalls === 0, "music_started ≠ requestState");

  bus.emit({ type: "app_opened", appId: "com.example", source: "external_project" });
  assert(memory.recentWithin("app_opened", Date.now(), 20_000), "app_opened → Memory");
  assert(requestStateCalls === 0, "app_opened ≠ requestState / no window targeting");

  // --- SophieAPI façade ---
  SophieAPI.connect({
    brain,
    needs,
    getStateId: () => machine.currentId,
    getActivity: () => memory.lastBehavior(),
    getUserPresence: () => "active",
  });
  const snap = SophieAPI.getSnapshot();
  assert(snap.state === "IDLE", "snapshot.state readable");
  assert(
    snap.personality.playful >= 0 && snap.personality.playful <= 1,
    "snapshot.personality in [0,1]",
  );
  assert(Object.isFrozen(snap), "snapshot is frozen (read-only)");
  assert(Object.isFrozen(snap.personality), "snapshot.personality frozen");

  // Attempt mutation should not affect internals
  try {
    (snap as { state: string }).state = "HACKED";
  } catch {
    /* freeze may throw in strict */
  }
  assert(machine.currentId === "IDLE", "mutating snapshot copy cannot change runtime state");
  assert(requestStateCalls === 0, "getSnapshot ≠ state mutation");

  SophieAPI.emit({ type: "wave", source: "test" });
  assert(memory.recentWithin("wave", Date.now(), 10_000), "SophieAPI.emit → Memory");
  assert(requestStateCalls === 0, "SophieAPI.emit ≠ requestState");

  detach();
  SophieAPI.disconnect();

  lines.push("All integration contract checks passed.");
  lines.push("");
  lines.push("Path verified:");
  lines.push("  external event → EventBus → Memory/notifyUserActivity → Brain wake");
  lines.push("  external event ≠ AnimationPlayer");
  lines.push("  external event ≠ StateMachine.request");
  lines.push("  external event ≠ Goal force");
  lines.push("");
  lines.push(
    'Confirmation: "Les systèmes externes fournissent uniquement des signaux ; le Brain conserve entièrement la responsabilité de la décision comportementale."',
  );

  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`Wrote ${OUT}`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
