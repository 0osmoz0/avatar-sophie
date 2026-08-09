/**
 * Phase 7 — Rapport de session runtime / personnalité.
 *
 * Usage:
 *   npx --yes tsx tools/runtime-personality-session-report.ts
 *   npx --yes tsx tools/runtime-personality-session-report.ts [path/to/runtime-session.json]
 *
 * Source typique : tools/.audit-cache/runtime-session.json
 * (persisté automatiquement par Sophie quand l'app tourne)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionExport } from "../src/behavior/RuntimeAudit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PATH = join(ROOT, "tools", ".audit-cache", "runtime-session.json");
const REPORT_PATH = join(ROOT, "tools", ".audit-cache", "runtime-session-report.txt");

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function classify(s: SessionExport): {
  p0: string[];
  p1: string[];
  p2: string[];
  p3: string[];
} {
  const p0: string[] = [];
  const p1: string[] = [];
  const p2: string[] = [];
  const p3: string[] = [];

  const picks = Math.max(1, s.pickCount);
  const idleShare = (s.distribution.idle ?? 0) / picks;
  const lookShare = (s.distribution.look ?? 0) / picks;
  const walkLook =
    (s.perceptualLoops["walk→look→walk"] ?? 0) +
    (s.perceptualLoops["look→walk→look"] ?? 0);
  const idleLook =
    (s.perceptualLoops["look→idle→look"] ?? 0) +
    (s.perceptualLoops["idle→look→idle"] ?? 0);
  const idleThink =
    (s.perceptualLoops["idle→think→idle"] ?? 0) +
    (s.perceptualLoops["think→idle→think"] ?? 0);

  // P0 — gênant perceptuellement
  if (walkLook >= 8 || (s.pickCount > 40 && walkLook / picks > 0.08)) {
    p0.push(
      `Boucle walk↔look perceptible (walk→look→walk + look→walk→look = ${walkLook})`,
    );
  }
  if (s.longestIdleMs > 180_000 && idleShare > 0.35) {
    p0.push(
      `Immobilité longue + idle dominant (longestIdle=${formatDuration(s.longestIdleMs)}, idle=${(100 * idleShare).toFixed(1)}%)`,
    );
  }

  // P1 — perceptible
  if (idleShare > 0.28) {
    p1.push(`idle fréquent (${(100 * idleShare).toFixed(1)}% des picks)`);
  }
  if (lookShare > 0.25) {
    p1.push(`look fréquent (${(100 * lookShare).toFixed(1)}%)`);
  }
  if (idleLook + idleThink >= 5) {
    p1.push(
      `Oscillations calmes idle↔look / idle↔think (n=${idleLook + idleThink})`,
    );
  }
  if (s.pickCount > 30 && s.exploreCount / picks < 0.02) {
    p1.push("Peu d'exploration (window/perch) sur la session");
  }
  if (s.longestIdleMs > 90_000 && s.longestIdleMs <= 180_000) {
    p1.push(`Temps mort idle ${formatDuration(s.longestIdleMs)}`);
  }
  if (
    s.longestActivityMs > 300_000 &&
    s.sessionDurationMs > 600_000 &&
    s.pickCount < 25
  ) {
    p1.push(
      `Activité longue sans re-décision (${formatDuration(s.longestActivityMs)}, ${s.pickCount} picks) — peut paraître « collée »`,
    );
  }

  // P2 — acceptable
  if ((s.distribution.dance ?? 0) === 0 && s.sessionDurationMs > 600_000) {
    p2.push("dance absente sur session longue — crédible si boredom bas");
  }
  if (s.emotionCount === 0 && s.interactionCount === 0) {
    p2.push("aucune émotion — normal sans interactions");
  } else if (s.emotionCount === 0 && s.interactionCount > 0) {
    p2.push("interactions sans émotion Brain (réactions immédiate user possible)");
  }
  if (s.focusCount / picks > 0.35) {
    p2.push(
      `focus élevé (${((100 * s.focusCount) / picks).toFixed(1)}%) — OK si focused_work`,
    );
  }

  // P3 — volontairement rare
  const rare = ["crying", "blow_kiss", "sleep", "eat"] as const;
  for (const id of rare) {
    if ((s.distribution[id] ?? 0) === 0) {
      p3.push(`${id} jamais vu — attendu hors contexte`);
    }
  }

  if (p0.length === 0 && p1.length === 0) {
    p2.push("Aucune boucle / immobilité flagrante détectée par heuristiques");
  }

  return { p0, p1, p2, p3 };
}

function formatReport(s: SessionExport): string {
  const lines: string[] = [];
  const section = (t: string) => {
    lines.push("");
    lines.push(t);
    lines.push("-".repeat(Math.min(36, t.length)));
  };

  lines.push("=== RUNTIME PERSONALITY SESSION ===");
  lines.push("");
  lines.push(`Duration: ${formatDuration(s.sessionDurationMs)}`);
  lines.push(`Picks: ${s.pickCount}`);
  lines.push(`Animations: ${s.animCount}`);
  lines.push(`Interactions: ${s.interactionCount}`);
  lines.push(`Deferred: ${s.deferredInteractionCount}`);

  section("Distribution");
  const dist = Object.entries(s.distribution).sort((a, b) => b[1] - a[1]);
  if (dist.length === 0) lines.push("(empty)");
  for (const [id, n] of dist) {
    const p = ((100 * n) / Math.max(1, s.pickCount)).toFixed(1);
    lines.push(`${id}: ${n} (${p}%)`);
  }

  section("Families");
  for (const [f, n] of Object.entries(s.families).sort((a, b) => b[1] - a[1])) {
    lines.push(`${f}: ${n}`);
  }
  lines.push(`emotionCount: ${s.emotionCount}`);
  lines.push(`locomotionCount: ${s.locomotionCount}`);
  lines.push(`focusCount: ${s.focusCount}`);
  lines.push(`exploreCount: ${s.exploreCount}`);
  lines.push(`restCount: ${s.restCount}`);
  lines.push(`calmCount: ${s.calmCount}`);

  section("Emotions");
  for (const [e, n] of Object.entries(s.emotions)) lines.push(`${e}: ${n}`);

  section("Durations");
  lines.push(`Longest idle: ${formatDuration(s.longestIdleMs)}`);
  lines.push(`Longest activity: ${formatDuration(s.longestActivityMs)}`);
  lines.push(
    `Avg decision interval: ${
      s.avgDecisionIntervalMs > 0
        ? formatDuration(s.avgDecisionIntervalMs)
        : "n/a"
    }`,
  );
  lines.push(
    `Soft wakes: ${s.softWakeCount ?? 0} (while busy: ${s.softWakeWhileBusy ?? 0})`,
  );
  lines.push(
    `Busy re-eval: ${s.redecisionsWhileBusy ?? 0} (preserved: ${s.busyPreserved ?? 0})`,
  );
  lines.push(`hang→idle: ${s.chains?.["hang→idle"] ?? 0}`);
  lines.push(`hang→fall: ${s.chains?.["hang→fall"] ?? 0}`);

  section("Top transitions");
  for (const t of s.topTransitions.slice(0, 15)) lines.push(`${t.key}: ${t.n}`);
  if (s.topTransitions.length === 0) lines.push("(none)");

  section("Potential perceptual loops");
  for (const [k, v] of Object.entries(s.perceptualLoops)) lines.push(`${k}: ${v}`);

  section("Deferred interactions");
  if (Object.keys(s.deferred).length === 0) lines.push("(none)");
  else for (const [k, v] of Object.entries(s.deferred)) lines.push(`${k}: ${v}`);

  section("Personality snapshots");
  const byTag = new Map<string, (typeof s.personalitySnapshots)[0]>();
  for (const p of s.personalitySnapshots) byTag.set(p.tag, p);
  if (byTag.size === 0) lines.push("(none)");
  for (const tag of ["focused_work", "idle_away", "gaming", "user_returned", "after:pet"]) {
    const p = byTag.get(tag);
    if (!p) continue;
    lines.push(
      `${tag}: playful=${p.playful.toFixed(2)} social=${p.social.toFixed(2)} ` +
        `curiosity=${p.curiosity.toFixed(2)} calm=${p.calm.toFixed(2)} ` +
        `independence=${p.independence.toFixed(2)}`,
    );
  }
  // autres tags
  for (const [tag, p] of byTag) {
    if (
      ["focused_work", "idle_away", "gaming", "user_returned", "after:pet"].includes(tag)
    ) {
      continue;
    }
    lines.push(
      `${tag}: playful=${p.playful.toFixed(2)} social=${p.social.toFixed(2)} ` +
        `curiosity=${p.curiosity.toFixed(2)} independence=${p.independence.toFixed(2)}`,
    );
  }

  const cls = classify(s);
  section("Classification P0 / P1 / P2 / P3");
  lines.push("P0 — gênant:");
  if (cls.p0.length === 0) lines.push("  (aucun)");
  else for (const x of cls.p0) lines.push(`  • ${x}`);
  lines.push("P1 — perceptible:");
  if (cls.p1.length === 0) lines.push("  (aucun)");
  else for (const x of cls.p1) lines.push(`  • ${x}`);
  lines.push("P2 — acceptable:");
  if (cls.p2.length === 0) lines.push("  (aucun)");
  else for (const x of cls.p2) lines.push(`  • ${x}`);
  lines.push("P3 — volontairement rare:");
  if (cls.p3.length === 0) lines.push("  (aucun)");
  else for (const x of cls.p3) lines.push(`  • ${x}`);

  section("Observations");
  if (s.observations.length === 0) lines.push("(aucune heuristique auto session)");
  else for (const o of s.observations) lines.push(`• ${o}`);
  lines.push("");
  lines.push(
    "NOTE: Aucune modification utility/cooldown/personality dans cette phase.",
  );
  lines.push("=== END SESSION REPORT ===");
  return lines.join("\n");
}

function usageHint(): void {
  console.log(`
=== RUNTIME PERSONALITY SESSION — usage ===

1. Rebuild : npm run desktop:install
2. Activer observation :
     localStorage.sophieObserveSession = "1"
   (force sophieDebugRuntime + sophieDebugBrain)
3. Session naturelle 15–20 min
4. Export auto → ${DEFAULT_PATH}
   ou : Sophie.runtimeAudit.flushSession()
5. Relancer : npx --yes tsx tools/runtime-personality-session-report.ts

Self-check structurel: OK (outil chargé).
`);
}

// --- main ---
mkdirSync(dirname(DEFAULT_PATH), { recursive: true });
const argPath = process.argv[2];
const path = argPath ?? DEFAULT_PATH;

if (!existsSync(path)) {
  usageHint();
  console.log(`Fichier absent: ${path}`);
  console.log("En attente d'une session réelle — pas de rapport chiffré.");
  process.exit(0);
}

const raw = readFileSync(path, "utf8");
const data = JSON.parse(raw) as SessionExport;
if (typeof data.pickCount !== "number" || typeof data.sessionDurationMs !== "number") {
  console.error("JSON invalide: SessionExport attendu");
  process.exit(1);
}

const report = formatReport(data);
console.log(report);
writeFileSync(REPORT_PATH, report);
console.log(`\nRapport écrit: ${REPORT_PATH}`);
