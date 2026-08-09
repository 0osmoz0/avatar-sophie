/**
 * Phase 9A — Audit des limites d'écran / surfaces (OBSERVATION ONLY).
 *
 * N'altère aucune utility / BehaviorBrain / cooldown.
 * Usage: npx --yes tsx tools/environment-boundary-audit.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Body } from "../src/motion/Body";
import { Locomotion, WALK_SPEED } from "../src/motion/Locomotion";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface BoundaryCounts {
  walkIntoVoid: number;
  hangTooLong: number;
  invalidPosition: number;
  noValidSurface: number;
  repeatedEdgeContact: number;
  walkPastEdge: number;
  hangWithoutFall: number;
  continueWalkAfterLimit: number;
  perchThenVoid: number;
  scenarios: number;
}

export interface BoundaryFinding {
  id: string;
  severity: "P0" | "P1" | "P2" | "P3" | "info";
  detail: string;
}

/** Bounds minimalistes pour simuler le sol / clamp (miroir ScreenBounds). */
class MockBounds {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly halfWidth = 40,
  ) {}
  get minX() {
    return 24 + this.halfWidth;
  }
  get maxX() {
    return this.width - 24 - this.halfWidth;
  }
  floorYAt(_x: number) {
    return this.height;
  }
  clampX(x: number) {
    return Math.min(this.maxX, Math.max(this.minX, x));
  }
  atEdge(x: number) {
    return x <= this.minX + 1 || x >= this.maxX - 1;
  }
}

function structuralFindings(): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const screen = readFileSync(join(ROOT, "src/motion/ScreenBounds.ts"), "utf8");
  const loco = readFileSync(join(ROOT, "src/motion/Locomotion.ts"), "utf8");
  const brain = readFileSync(join(ROOT, "src/behavior/BehaviorBrain.ts"), "utf8");
  const states = readFileSync(join(ROOT, "src/state/states.ts"), "utf8");
  const world = readFileSync(join(ROOT, "src/world/WorldModel.ts"), "utf8");

  findings.push({
    id: "clampX_exists",
    severity: "info",
    detail: screen.includes("clampX")
      ? "ScreenBounds.clampX existe — locomotion bloque latéralement"
      : "clampX absent",
  });
  findings.push({
    id: "atEdge_unused",
    severity: "P2",
    detail: /atEdge\(/.test(screen)
      ? "ScreenBounds.atEdge défini mais non consommé par le Brain (grep catalog)"
      : "atEdge absent",
  });
  findings.push({
    id: "no_window_surface_collision",
    severity: "P1",
    detail: !/raycast|collide|onWindowSurface|validSurface/.test(loco + world)
      ? "Pas de validation collision fenêtre — perch = téléport ancre held"
      : "Collision surface détectée",
  });
  findings.push({
    id: "hang_timeout_filet",
    severity: "info",
    detail: /elapsed > 14/.test(states)
      ? "HangState filet elapsed>14 → IDLE (Phase 8)"
      : "Pas de filet HangState",
  });
  findings.push({
    id: "idle_force_exit",
    severity: "info",
    detail: /forceState:\s*true/.test(brain)
      ? "BehaviorBrain force IDLE en fin de goal (Phase 8)"
      : "Fin de goal sans force IDLE",
  });
  findings.push({
    id: "floor_only_surface",
    severity: "P1",
    detail:
      "Surface « valide » = work-area floorYAt uniquement — pas de ledge/fenêtre physique",
  });
  findings.push({
    id: "y_ignored_goto",
    severity: "P2",
    detail:
      "Locomotion goTo est X-only — body.y hors sol seulement via held/freefall/perch",
  });

  const catalog = readFileSync(
    join(ROOT, "src/behavior/considerations/catalog.ts"),
    "utf8",
  );
  if (!catalog.includes("atEdge")) {
    findings.push({
      id: "brain_ignores_atEdge",
      severity: "P1",
      detail: "Considerations n'appellent pas ScreenBounds.atEdge ni distance*Edge",
    });
  }

  return findings;
}

/** Scénarios physiques passifs — comptage d'anomalies, aucune correction. */
export function simulateBoundaryScenarios(): {
  counts: BoundaryCounts;
  findings: BoundaryFinding[];
} {
  const counts: BoundaryCounts = {
    walkIntoVoid: 0,
    hangTooLong: 0,
    invalidPosition: 0,
    noValidSurface: 0,
    repeatedEdgeContact: 0,
    walkPastEdge: 0,
    hangWithoutFall: 0,
    continueWalkAfterLimit: 0,
    perchThenVoid: 0,
    scenarios: 0,
  };
  const findings: BoundaryFinding[] = [...structuralFindings()];

  const bounds = new MockBounds(1440, 900);
  const loco = new Locomotion(bounds as unknown as import("../src/motion/ScreenBounds").ScreenBounds);
  const EDGE_THRESH = 40;

  // --- 1. Marche vers bord gauche / droit ---
  for (const dir of [-1, 1] as const) {
    counts.scenarios += 1;
    const body = new Body();
    body.x = bounds.width / 2;
    body.y = bounds.height;
    body.grounded = true;
    const target = dir < 0 ? bounds.minX - 80 : bounds.maxX + 80;
    let edgeHits = 0;
    let blockedAtLimit = false;
    for (let i = 0; i < 400; i++) {
      const before = body.x;
      const r = loco.apply(
        body,
        { kind: "moveTo", x: target, speed: WALK_SPEED },
        1 / 60,
      );
      const distEdge =
        dir < 0 ? body.x - bounds.minX : bounds.maxX - body.x;
      if (distEdge < EDGE_THRESH && Math.sign(body.vx || dir) === dir) {
        counts.walkIntoVoid += 1; // intention vers le vide / hors marge
      }
      if (bounds.atEdge(body.x)) edgeHits += 1;
      if (r.blocked) blockedAtLimit = true;
      if (body.x < 0 || body.x > bounds.width) counts.invalidPosition += 1;
      if (Math.abs(body.x - before) < 0.01 && bounds.atEdge(body.x)) {
        counts.continueWalkAfterLimit += 1;
        break;
      }
    }
    if (!blockedAtLimit && (body.x < bounds.minX - 1 || body.x > bounds.maxX + 1)) {
      counts.walkPastEdge += 1;
    }
    if (edgeHits >= 3) counts.repeatedEdgeContact += 1;
  }

  // --- 2. Haut / bas (Y) — locomotion n'empêche pas Y held hors sol ---
  counts.scenarios += 1;
  {
    const body = new Body();
    body.x = 400;
    body.y = 100; // dans le « vide » vertical
    body.grounded = false;
    loco.apply(body, { kind: "held", x: body.x, y: body.y }, 1 / 60);
    if (!body.grounded && body.y < bounds.floorYAt(body.x) - 5) {
      counts.noValidSurface += 1;
      counts.perchThenVoid += 1;
    }
  }

  // --- 3. Coins ---
  for (const x of [bounds.minX, bounds.maxX]) {
    counts.scenarios += 1;
    const body = new Body();
    body.x = x;
    body.y = bounds.height;
    body.grounded = true;
    loco.apply(body, { kind: "moveTo", x: x + (x === bounds.minX ? -50 : 50), speed: WALK_SPEED }, 0.5);
    if (bounds.atEdge(body.x)) counts.repeatedEdgeContact += 0; // contact coin = edge
    const clamped = bounds.clampX(body.x);
    if (clamped !== body.x && Math.abs(body.x - clamped) > 2) {
      counts.invalidPosition += 1;
    }
  }

  // --- 4. HANG prolongé (simulation logique état) ---
  counts.scenarios += 1;
  {
    const hangElapsed = 20; // > 14s filet Phase 8
    if (hangElapsed > 14) {
      counts.hangTooLong += 1;
      findings.push({
        id: "hang_over_14_detectable",
        severity: "P2",
        detail:
          "HANG >14s détectable ; filet HangState existe post-Phase 8 — risque réduit mais à monitorer runtime",
      });
    }
    // Avant Phase 8 : hangWithoutFall était le P1 — structurellement possible si force IDLE cassé
    const brain = readFileSync(join(ROOT, "src/behavior/BehaviorBrain.ts"), "utf8");
    if (!/forceState:\s*true/.test(brain)) {
      counts.hangWithoutFall += 1;
    }
  }

  // --- 5. FALL → sol ---
  counts.scenarios += 1;
  {
    const body = new Body();
    body.x = 500;
    body.y = 200;
    body.grounded = false;
    body.vy = 0;
    let landed = false;
    for (let i = 0; i < 300; i++) {
      const r = loco.apply(body, { kind: "freefall" }, 1 / 60);
      if (r.landed) {
        landed = true;
        break;
      }
    }
    if (!landed) {
      counts.noValidSurface += 1;
      findings.push({
        id: "fall_never_lands",
        severity: "P0",
        detail: "FALL freefall n'a pas touché floorYAt en 5s simulées",
      });
    } else {
      findings.push({
        id: "fall_lands_ok",
        severity: "info",
        detail: "FALL → floorYAt fonctionne en simulation",
      });
    }
  }

  // --- 6. Perch held puis disparition « surface » (ancre reste, pas de validation) ---
  counts.scenarios += 1;
  {
    const body = new Body();
    const anchorY = 120;
    body.x = 80;
    body.y = anchorY;
    // held maintient grounded=false même si « fenêtre » disparue du modèle
    for (let i = 0; i < 60; i++) {
      loco.apply(body, { kind: "held", x: 80, y: anchorY }, 1 / 60);
    }
    if (!body.grounded) {
      counts.perchThenVoid += 1;
      counts.noValidSurface += 1;
      findings.push({
        id: "held_ignores_window_lifetime",
        severity: "P1",
        detail:
          "Intent held ignore si la fenêtre/edge source existe encore — Sophie peut rester suspendue dans le vide logique",
      });
    }
  }

  // --- 7. WALK après clamp : continue de « vouloir » le bord ---
  counts.scenarios += 1;
  {
    const body = new Body();
    body.x = bounds.maxX;
    body.y = bounds.height;
    body.grounded = true;
    let stillTrying = 0;
    for (let i = 0; i < 120; i++) {
      loco.apply(body, { kind: "moveTo", x: bounds.maxX + 200, speed: WALK_SPEED }, 1 / 60);
      if (bounds.atEdge(body.x) && Math.abs(body.vx) < 1) stillTrying += 1;
    }
    if (stillTrying > 30) {
      counts.continueWalkAfterLimit += 1;
      findings.push({
        id: "walk_stuck_at_edge",
        severity: "P2",
        detail:
          "Après clamp, moveTo vers l'extérieur laisse Sophie au bord (WALK peut persister côté Brain goal)",
      });
    }
  }

  return { counts, findings };
}

export function formatBoundaryReport(
  data = simulateBoundaryScenarios(),
): string {
  const { counts, findings } = data;
  const lines: string[] = [];
  lines.push("=== ENVIRONMENT BOUNDARY AUDIT ===");
  lines.push("(observation only — aucune correction)");
  lines.push("");
  lines.push(`Scenarios run: ${counts.scenarios}`);
  lines.push("");
  lines.push("Risk counters");
  lines.push("-------------");
  lines.push(`walkIntoVoid (intent toward edge): ${counts.walkIntoVoid}`);
  lines.push(`walkPastEdge: ${counts.walkPastEdge}`);
  lines.push(`continueWalkAfterLimit: ${counts.continueWalkAfterLimit}`);
  lines.push(`hangTooLong: ${counts.hangTooLong}`);
  lines.push(`hangWithoutFall (no force IDLE): ${counts.hangWithoutFall}`);
  lines.push(`invalidPosition: ${counts.invalidPosition}`);
  lines.push(`noValidSurface: ${counts.noValidSurface}`);
  lines.push(`repeatedEdgeContact: ${counts.repeatedEdgeContact}`);
  lines.push(`perchThenVoid (held sans validation): ${counts.perchThenVoid}`);
  lines.push("");
  lines.push("Findings");
  lines.push("--------");
  for (const f of findings) {
    lines.push(`[${f.severity}] ${f.id}: ${f.detail}`);
  }
  lines.push("");
  lines.push("=== END BOUNDARY AUDIT ===");
  return lines.join("\n");
}

function printBoundaryCli(): void {
  console.log(formatBoundaryReport());
  const session = join(ROOT, "tools/.audit-cache/runtime-session.json");
  if (existsSync(session)) {
    const s = JSON.parse(readFileSync(session, "utf8")) as {
      longestActivityMs?: number;
      chains?: Record<string, number>;
      pickCount?: number;
    };
    console.log("\n--- Runtime session (si présent, non simulé) ---");
    console.log(`picks: ${s.pickCount ?? "?"}`);
    console.log(
      `longestActivity: ${((s.longestActivityMs ?? 0) / 1000).toFixed(1)}s`,
    );
    console.log(`hang→idle: ${s.chains?.["hang→idle"] ?? 0}`);
    console.log(`hang→fall: ${s.chains?.["hang→fall"] ?? 0}`);
    console.log(`perch→hang: ${s.chains?.["perch→hang"] ?? 0}`);
  } else {
    console.log("\n(Pas de runtime-session.json — simulation only)");
  }
}

const isDirectRun = process.argv[1]?.includes("environment-boundary-audit");
if (isDirectRun) printBoundaryCli();
