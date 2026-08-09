/**
 * Phase 9A — Audit environnemental complet (OBSERVATION ONLY).
 *
 * N'altère aucune logique comportementale.
 * Usage: npx --yes tsx tools/environment-audit.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor, DesktopWindow } from "../src/world/types";
import {
  emptyUserActivitySnapshot,
  makeTestSnapshot,
} from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import {
  formatBoundaryReport,
  simulateBoundaryScenarios,
} from "./environment-boundary-audit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", ".audit-cache");
const REPORT_PATH = join(CACHE, "environment-audit-report.txt");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function yesNo(v: boolean): string {
  return v ? "oui" : "non";
}

function mockBody(partial?: Partial<Body>): Body {
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
    ...partial,
  } as unknown as Body;
}

function mockCursor(partial?: Partial<CursorTracker>): CursorTracker {
  const c = {
    x: 420,
    y: 800,
    vx: 0,
    vy: 0,
    moving: false,
    idleSeconds: 5,
    distanceTo(x: number, y: number) {
      return Math.hypot(this.x - x, this.y - y);
    },
    ...partial,
  };
  return c as unknown as CursorTracker;
}

function baseWorld(partial?: Partial<WorldSnapshot>): WorldSnapshot {
  const edge: EdgeAnchor = {
    kind: "screen-left",
    x: 64,
    y: 200,
    facing: 1,
    label: "left",
  };
  const win: DesktopWindow = {
    id: 1,
    title: "Code",
    owner: "Cursor",
    x: 200,
    y: 100,
    width: 800,
    height: 600,
    layer: 0,
    onScreen: true,
  };
  return {
    originX: 0,
    originY: 0,
    width: 1440,
    height: 900,
    scaleFactor: 2,
    monitors: [
      {
        id: 0,
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        scaleFactor: 2,
        workX: 0,
        workY: 0,
        workWidth: 1440,
        workHeight: 900,
        primary: true,
      },
    ],
    windows: [win],
    accessibilityTrusted: true,
    nearestWindow: win,
    nearestEdge: edge,
    points: [
      { id: "floor-a", x: 400, y: 900, kind: "floor", score: 1 },
      { id: "corner-a", x: 64, y: 900, kind: "corner", score: 0.8 },
      { id: "edge-a", x: 64, y: 200, kind: "edge", score: 0.9, anchor: edge },
    ],
    updatedAt: Date.now(),
    ...partial,
  };
}

function makeCtx(partial?: {
  body?: Partial<Body>;
  cursor?: Partial<CursorTracker>;
  world?: Partial<WorldSnapshot>;
  needs?: Partial<Needs>;
  user?: Parameters<typeof makeTestSnapshot>[0];
  stateId?: BrainContext["stateId"];
  idleSeconds?: number;
}): BrainContext {
  const userActivity = makeTestSnapshot(partial?.user ?? { category: "coding" });
  const needs = new Needs();
  if (partial?.needs) Object.assign(needs, partial.needs);
  return {
    now: 1_000_000,
    body: mockBody(partial?.body),
    cursor: mockCursor(partial?.cursor),
    needs,
    memory: new Memory(),
    world: baseWorld(partial?.world),
    userActivity,
    interpretedContext: interpretRules(userActivity),
    stateId: partial?.stateId ?? "IDLE",
    idleSeconds: partial?.idleSeconds ?? 8,
    hour: 15,
  };
}

// --- Inventory table -------------------------------------------------------

type Cell = "oui" | "non" | "partiel" | "proxy";

interface InventoryRow {
  info: string;
  exists: Cell;
  source: string;
  brain: Cell;
  used: Cell;
}

function inventoryTable(): InventoryRow[] {
  return [
    {
      info: "screen width",
      exists: "oui",
      source: "WorldSnapshot.width / ScreenBounds",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "screen height",
      exists: "oui",
      source: "WorldSnapshot.height / floorY",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "Sophie X",
      exists: "oui",
      source: "Body.x",
      brain: "oui",
      used: "oui",
    },
    {
      info: "Sophie Y",
      exists: "oui",
      source: "Body.y",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "distance left edge",
      exists: "non",
      source: "dérivable body.x − minX",
      brain: "non",
      used: "non",
    },
    {
      info: "distance right edge",
      exists: "non",
      source: "dérivable maxX − body.x",
      brain: "non",
      used: "non",
    },
    {
      info: "distance top edge",
      exists: "non",
      source: "dérivable body.y",
      brain: "non",
      used: "non",
    },
    {
      info: "distance bottom edge",
      exists: "non",
      source: "dérivable floorYAt − body.y",
      brain: "non",
      used: "non",
    },
    {
      info: "near corner",
      exists: "partiel",
      source: "WorldSnapshot.points kind=corner",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "valid surface",
      exists: "partiel",
      source: "Body.grounded + floorYAt only",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "cursor position",
      exists: "oui",
      source: "CursorTracker.x/y",
      brain: "oui",
      used: "oui",
    },
    {
      info: "cursor distance",
      exists: "oui",
      source: "CursorTracker.distanceTo",
      brain: "oui",
      used: "oui",
    },
    {
      info: "cursor moving",
      exists: "oui",
      source: "CursorTracker.moving (v>40)",
      brain: "oui",
      used: "oui",
    },
    {
      info: "user idle",
      exists: "oui",
      source: "userIdle / idle_away",
      brain: "oui",
      used: "oui",
    },
    {
      info: "user focused",
      exists: "oui",
      source: "focused_work / userBusy",
      brain: "oui",
      used: "oui",
    },
    {
      info: "active application",
      exists: "oui",
      source: "activeApp + category",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "music playing",
      exists: "non",
      source: "audioPlaying: null placeholder",
      brain: "non",
      used: "non",
    },
    {
      info: "audio application",
      exists: "proxy",
      source: "category=media si Spotify/Music frontmost",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "volume",
      exists: "non",
      source: "—",
      brain: "non",
      used: "non",
    },
    {
      info: "music changed",
      exists: "non",
      source: "—",
      brain: "non",
      used: "non",
    },
    {
      info: "window position",
      exists: "oui",
      source: "nearestWindow / windows[]",
      brain: "oui",
      used: "partiel",
    },
    {
      info: "perch position",
      exists: "oui",
      source: "nearestEdge → goal.anchor",
      brain: "oui",
      used: "oui",
    },
  ];
}

// --- Cursor audit ----------------------------------------------------------

function auditCursor(): string[] {
  const lines: string[] = [];
  const near = makeCtx({
    cursor: { x: 410, y: 820, moving: true, vx: 120, vy: 10, idleSeconds: 0.1 },
    body: { x: 400, y: 900 },
  });
  const far = makeCtx({
    cursor: { x: 1200, y: 100, moving: false, vx: 0, vy: 0, idleSeconds: 8 },
    body: { x: 400, y: 900 },
  });
  const leaving = makeCtx({
    cursor: { x: 700, y: 800, moving: true, vx: 300, vy: 0, idleSeconds: 0 },
    body: { x: 400, y: 900 },
  });

  const dNear = near.cursor.distanceTo(near.body.x, near.body.y - 80);
  const dFar = far.cursor.distanceTo(far.body.x, far.body.y - 80);
  const dLeave = leaving.cursor.distanceTo(leaving.body.x, leaving.body.y - 80);

  const cursorCons = ALL_CONSIDERATIONS.find((c) => c.id === "cursor")!;
  const uNear = cursorCons.utility(near);
  const uFar = cursorCons.utility(far);

  lines.push(`distance near: ${dNear.toFixed(0)}px → cursor utility=${uNear.toFixed(3)}`);
  lines.push(`distance far: ${dFar.toFixed(0)}px → cursor utility=${uFar.toFixed(3)}`);
  lines.push(`moving flag: ${yesNo(near.cursor.moving)} (seuil hypot(vx,vy)>40)`);
  lines.push(`idleSeconds far: ${far.cursor.idleSeconds}s`);
  lines.push(`cursorApproaching: NON dédié (dérivable distance↓ + moving) — absent`);
  lines.push(`cursorLeaving: NON dédié (dérivable distance↑ + vx away) — absent`);
  lines.push(`cursorNearby: implicite dans consideration (dist seuils) — pas de flag Context`);
  lines.push(`cursorIdle: via idleSeconds / !moving — utilisé partiellement`);
  lines.push(`vitesse: CursorTracker.vx/vy exposés au Brain — non scorés hors moving bool`);
  lines.push(`PET/POKE/DRAG: PointerInput + InteractionResolver (pas EnvironmentContext)`);
  lines.push(`leaving sample dist=${dLeave.toFixed(0)} (pas de signal dédié)`);
  return lines;
}

// --- Window / perch --------------------------------------------------------

function auditWindowPerch(): string[] {
  const lines: string[] = [];
  const perch = ALL_CONSIDERATIONS.find((c) => c.id === "perch")!;
  const win = ALL_CONSIDERATIONS.find((c) => c.id === "window")!;
  const ctx = makeCtx({
    needs: { curiosity: 70, boredom: 40 } as Partial<Needs>,
  });
  // Needs is a class — set via assign carefully
  ctx.needs.curiosity = 70;
  ctx.needs.boredom = 40;

  lines.push(`proche perch: nearestEdge ? ${yesNo(!!ctx.world.nearestEdge)} utility=${perch.utility(ctx).toFixed(3)}`);
  lines.push(`proche window: nearestWindow ? ${yesNo(!!ctx.world.nearestWindow)} utility=${win.utility(ctx).toFixed(3)}`);
  lines.push("accroche: goal perch → force HANG + held à anchor (pas de test surface OS)");
  lines.push("arrêt goTo: dist<10 && speed<5 OU timeout 12–90s");
  lines.push("retour surface: fall→floorYAt OU dismount grounded+prePerchY");
  lines.push("surface valide: Body.grounded après floor — AUCUNE validation window-top live");
  lines.push("risque: perch → HANG → fenêtre disparait → held continue (void logique)");
  lines.push("risque: walk → clamp edge → goal goTo peut rester actif sans « conscience » du bord");
  const brain = src("src/behavior/BehaviorBrain.ts");
  lines.push(
    `HangState/Brain filets Phase 8: ${yesNo(/busyOrphan|elapsed > 14|forceState:\s*true/.test(brain + src("src/state/states.ts")))}`,
  );
  return lines;
}

// --- Audio feasibility -----------------------------------------------------

function auditAudio(): string[] {
  const lines: string[] = [];
  const ua = src("src/user/UserActivitySnapshot.ts");
  const rustFiles = ["src-tauri/src/lib.rs", "src-tauri/src/user_activity.rs", "src-tauri/src/macos.rs"]
    .map((f) => src(f))
    .join("\n");

  lines.push("### Disponible directement");
  lines.push("- App frontmost + category (Spotify/Music → media)");
  lines.push("- Mode interprété media_watching (si category media + activité)");
  lines.push("- Placeholder UserActivitySnapshot.audioPlaying = null");
  lines.push("");
  lines.push("### Disponible avec API macOS (non branché)");
  lines.push("- MediaRemote / Now Playing (privé, fragile cross-OS)");
  lines.push("- AppleScript Spotify/Music (play state, track) — app-specific");
  lines.push("- NSWorkspace notifications déjà partiellement utilisés (app change)");
  lines.push("");
  lines.push("### Disponible avec permission utilisateur");
  lines.push("- Accessibility déjà requis pour fenêtres (AXIsProcessTrusted)");
  lines.push("- Automation permission pour AppleScript control d'apps");
  lines.push("");
  lines.push("### Disponible uniquement avec intégration externe");
  lines.push("- Spotify Web API (OAuth) pour track change fiable hors frontmost");
  lines.push("- Browser YouTube: quasi impossible sans extension / accessibilité lourde");
  lines.push("");
  lines.push("### Impossible / non fiable");
  lines.push("- Volume système + « musique » générique sans Now Playing");
  lines.push("- Détecter YouTube dans un onglet sans API navigateur");
  lines.push("- audioPlaying actuel: " + (ua.includes("audioPlaying: null") ? "toujours null" : "?"));
  lines.push(
    `- Code natif audio: ${/NowPlaying|MediaRemote|MRMedia|spotify|volume/i.test(rustFiles) ? "traces" : "aucune"}`,
  );
  lines.push("");
  lines.push("### Architecture future proposée (ne pas implémenter en 9A)");
  lines.push("1. Couche AudioPresence { playing:boolean|null, source:'nowplaying'|'app'|'unknown', app?, title? }");
  lines.push("2. Remplir audioPlaying via MediaRemote soft OR AppleScript poll lent (2–5s)");
  lines.push("3. Events: audio_started / audio_stopped / track_changed → Memory + wake soft");
  lines.push("4. Considerations dance/excited lisent le flag — jamais requestState forcé");
  lines.push("5. Fallback: category=media reste proxy faible si API indisponible");
  return lines;
}

// --- Simulation 5000 -------------------------------------------------------

interface SimRisks {
  walkEdgeOscillation: number;
  hangRecoverHang: number;
  lookWalkLook: number;
  edgeContactWalk: number;
  picks: number;
  dist: Record<string, number>;
}

function runSimulation(n = 5000): SimRisks {
  const risks: SimRisks = {
    walkEdgeOscillation: 0,
    hangRecoverHang: 0,
    lookWalkLook: 0,
    edgeContactWalk: 0,
    picks: 0,
    dist: {},
  };
  const scenarios = [
    { category: "coding" as const, overallLevel: "high" as const, userBusy: true },
    { category: "unknown" as const, overallLevel: "idle" as const, userIdle: true, secondsSinceLastInput: 300 },
    { category: "gaming" as const, overallLevel: "high" as const, userBusy: true },
    { category: "media" as const, overallLevel: "medium" as const },
    { category: "browser" as const, overallLevel: "low" as const },
  ];

  const history: string[] = [];
  for (let i = 0; i < n; i++) {
    const sc = scenarios[i % scenarios.length]!;
    const edgeNear = i % 7 === 0;
    const cursorNear = i % 11 === 0;
    const ctx = makeCtx({
      user: sc,
      body: {
        x: edgeNear ? 70 : 400 + (i % 50),
        y: 900,
        grounded: true,
      },
      cursor: cursorNear
        ? { x: 410, y: 850, moving: true, vx: 80, vy: 0, idleSeconds: 0.2 }
        : { x: 900, y: 200, moving: false, idleSeconds: 4 },
      world: edgeNear
        ? {}
        : { nearestEdge: null },
      idleSeconds: 5 + (i % 20),
    });
    ctx.needs.curiosity = 40 + (i % 50);
    ctx.needs.boredom = 30 + (i % 40);
    ctx.needs.energy = 50 + (i % 40);
    ctx.needs.fatigue = 20 + (i % 50);

    const scored = ALL_CONSIDERATIONS.map((c) => ({
      id: c.id,
      u: c.utility(ctx) * (0.88 + Math.random() * 0.24),
    })).sort((a, b) => b.u - a.u);
    const pick = scored[0]!;
    if (pick.u <= 0) continue;
    risks.picks += 1;
    risks.dist[pick.id] = (risks.dist[pick.id] ?? 0) + 1;
    history.push(pick.id);
    if (history.length > 8) history.shift();

    if (history.length >= 3) {
      const a = history[history.length - 3]!;
      const b = history[history.length - 2]!;
      const c = history[history.length - 1]!;
      if (a === "look" && b === "walk" && c === "look") risks.lookWalkLook += 1;
      if (a === "walk" && b === "look" && c === "walk") risks.walkEdgeOscillation += 1;
      if (a === "perch" && b === "idle" && c === "perch") risks.hangRecoverHang += 1;
    }
    if (edgeNear && pick.id === "walk") risks.edgeContactWalk += 1;
  }
  return risks;
}

// --- Animation inventory ---------------------------------------------------

interface AnimNeed {
  id: string;
  category: string;
  why: string;
  trigger: string;
  conditions: string;
  reusable: string;
  newNeeded: boolean;
  priority: "P0" | "P1" | "P2" | "P3";
}

function animationInventory(): AnimNeed[] {
  const existing = src("src/assets/generated/animations.ts");
  const has = (id: string) => existing.includes(`"${id}"`);
  return [
    {
      id: "edge_peek",
      category: "EDGE",
      why: "Montrer que Sophie remarque le bord sans perch systématique",
      trigger: "nearLeft/RightEdge + curiosity",
      conditions: "grounded, !BUSY, distanceEdge < seuil",
      reusable: has("look_around") ? "look_around (partiel)" : "—",
      newNeeded: true,
      priority: "P1",
    },
    {
      id: "edge_turn",
      category: "EDGE",
      why: "Éviter la perception walk-into-void au clamp",
      trigger: "atEdge + moveTo hors bounds",
      conditions: "WALK goal vers extérieur",
      reusable: has("walk") ? "walk + facing flip" : "—",
      newNeeded: false,
      priority: "P1",
    },
    {
      id: "window_lean",
      category: "WINDOW",
      why: "Différencier window de push/pull générique",
      trigger: "nearWindow",
      conditions: "curiosity, !focused strict",
      reusable: has("push") && has("pull") ? "push/pull existent" : "—",
      newNeeded: false,
      priority: "P2",
    },
    {
      id: "perch_settle",
      category: "PERCH",
      why: "Transition visuelle goTo → HANG",
      trigger: "arrive edge → perch",
      conditions: "goal perch start",
      reusable: has("hang") ? "hang" : "—",
      newNeeded: false,
      priority: "P3",
    },
    {
      id: "dismount",
      category: "PERCH",
      why: "Rendre lisible la redescente sans chute",
      trigger: "hang → idle dismount",
      conditions: "chooseAfterPerch undefined",
      reusable: has("fall") ? "pas idéal ; walk/idle" : "—",
      newNeeded: true,
      priority: "P2",
    },
    {
      id: "fall",
      category: "FALL / RECOVERY",
      why: "Déjà présent",
      trigger: "perch-fall / drag release",
      conditions: "!grounded",
      reusable: "fall",
      newNeeded: false,
      priority: "P3",
    },
    {
      id: "surprise",
      category: "FALL / RECOVERY",
      why: "Déjà présent (landed)",
      trigger: "notifyLanded",
      conditions: "after FALL",
      reusable: "surprise",
      newNeeded: false,
      priority: "P3",
    },
    {
      id: "confused",
      category: "CONFUSION",
      why: "Surface disparue / void logique / edge absurde",
      trigger: "inVoid || invalidPosition || window lost while HANG",
      conditions: "rare, !BUSY long",
      reusable: has("think") ? "think (faible)" : "—",
      newNeeded: true,
      priority: "P1",
    },
    {
      id: "chase",
      category: "CURSOR",
      why: "Déjà présent",
      trigger: "cursor chase",
      conditions: "curious + moving + near",
      reusable: "chase / run",
      newNeeded: false,
      priority: "P3",
    },
    {
      id: "notice_cursor",
      category: "CURSOR",
      why: "CURSOR_NOTICE → surprise déjà",
      trigger: "cursor notice",
      conditions: "dist moyenne",
      reusable: "surprise",
      newNeeded: false,
      priority: "P3",
    },
    {
      id: "dance_to_music",
      category: "MUSIC",
      why: "Lier dance à vraie présence audio (quand API existera)",
      trigger: "audioPlaying==true",
      conditions: "energy OK, !focused_work strict",
      reusable: "dance1–6",
      newNeeded: false,
      priority: "P2",
    },
    {
      id: "headbob",
      category: "MUSIC",
      why: "Micro-réaction musique sans full dance",
      trigger: "audioPlaying soft",
      conditions: "focused_work compatible",
      reusable: "aucune",
      newNeeded: true,
      priority: "P2",
    },
    {
      id: "wave",
      category: "SOCIAL",
      why: "Déjà présent (user return / wave)",
      trigger: "interaction / return",
      conditions: "Memory",
      reusable: "wave / happy",
      newNeeded: false,
      priority: "P3",
    },
  ];
}

// --- Unused context --------------------------------------------------------

function accessibleUnused(): string[] {
  return [
    "world.monitors[] (multi-écran floors disponibles)",
    "world.windows[] liste complète (seul nearestWindow scoré)",
    "world.originX/Y, scaleFactor, updatedAt, accessibilityTrusted",
    "ScreenBounds.atEdge (défini, jamais lu par Brain)",
    "Body.vy, Body.moving (hors anim selector)",
    "CursorTracker.vx/vy numériques (seul bool moving)",
    "userActivity.audioPlaying (null)",
    "userActivity.recentApps",
    "userActivity.keyboardLevel / pointerLevel bruts",
    "POI kind=corner score (mélange walk, pas nearCorner bool)",
    "distances edge top/bottom/left/right (non matérialisées)",
  ];
}

function missingContext(): string[] {
  return [
    "EnvironmentContext unifié (proposition Étape C — NON créé en 9A)",
    "distanceLeft/Right/Top/Bottom + near*Edge flags",
    "nearCorner bool",
    "onValidSurface / inVoid (au-delà de grounded)",
    "cursorApproaching / cursorLeaving",
    "music playing / track change / volume",
    "window lifetime / edge still valid pendant HANG",
    "surface ledge raycast",
  ];
}

// --- Main report -----------------------------------------------------------

function buildReport(): string {
  const lines: string[] = [];
  const boundary = simulateBoundaryScenarios();
  const sim = runSimulation(5000);
  const inv = inventoryTable();
  const anims = animationInventory();

  lines.push("=== SOPHIE ENVIRONMENT AUDIT ===");
  lines.push("Phase 9A — OBSERVATION ONLY");
  lines.push("");

  lines.push("SCREEN");
  lines.push("------");
  lines.push("bounds: WorldSnapshot width/height + ScreenBounds minX/maxX/floorYAt (multi-moniteur)");
  lines.push("position: Body.x/y — Brain y a accès");
  lines.push("edge awareness: nearestEdge POI oui ; distances/atEdge NON scorés explicitement");
  lines.push("corner awareness: points kind=corner oui ; flag nearCorner non");
  lines.push("surface awareness: grounded + floor work-area seulement");
  lines.push("void awareness: ABSENTE (held/perch peuvent être « dans le vide » logique)");
  lines.push("");

  lines.push("CURSOR");
  lines.push("------");
  for (const l of auditCursor()) lines.push(l);
  lines.push("");

  lines.push("WINDOW / PERCH");
  lines.push("--------------");
  for (const l of auditWindowPerch()) lines.push(l);
  lines.push("");

  lines.push("USER");
  lines.push("----");
  lines.push("idle: userIdle + mode idle_away — oui, modifiers");
  lines.push("focused: focused_work / userBusy — oui");
  lines.push("gaming: mode gaming — oui");
  lines.push("return: user_returned Memory + wake — oui");
  lines.push("combinable env: OUI techniquement (même BrainContext) — pas de jointure Environment×User dédiée");
  lines.push("PET/POKE/DRAG: InteractionResolver — orthogonal à l'env spatial");
  lines.push("");

  lines.push("AUDIO");
  lines.push("-----");
  for (const l of auditAudio()) lines.push(l);
  lines.push("");

  lines.push("BEHAVIORAL RISKS");
  lines.push("----------------");
  lines.push(`walk into void (sim boundary intent): ${boundary.counts.walkIntoVoid}`);
  lines.push(`hang orphan / too long: hangTooLong=${boundary.counts.hangTooLong} hangWithoutFall=${boundary.counts.hangWithoutFall}`);
  lines.push(`invalid position: ${boundary.counts.invalidPosition}`);
  lines.push(`no valid surface / perch void: ${boundary.counts.noValidSurface} / ${boundary.counts.perchThenVoid}`);
  lines.push(`edge loop / continue after limit: ${boundary.counts.repeatedEdgeContact} / ${boundary.counts.continueWalkAfterLimit}`);
  lines.push(`perceptual look↔walk (sim 5k): ${sim.lookWalkLook}`);
  lines.push(`walk↔look oscillation (sim 5k): ${sim.walkEdgeOscillation}`);
  lines.push(`edgeContact+walk pick (sim): ${sim.edgeContactWalk}`);
  lines.push(`perch→idle→perch (sim): ${sim.hangRecoverHang}`);
  lines.push("");

  // Runtime if any
  const sessionPath = join(CACHE, "runtime-session.json");
  lines.push("RUNTIME SESSION");
  lines.push("---------------");
  if (existsSync(sessionPath)) {
    const s = JSON.parse(readFileSync(sessionPath, "utf8")) as {
      sessionDurationMs?: number;
      pickCount?: number;
      longestActivityMs?: number;
      chains?: Record<string, number>;
      perceptualLoops?: Record<string, number>;
      distribution?: Record<string, number>;
    };
    lines.push(`(réel) duration=${((s.sessionDurationMs ?? 0) / 60000).toFixed(1)} min picks=${s.pickCount}`);
    lines.push(`longestActivity=${((s.longestActivityMs ?? 0) / 1000).toFixed(1)}s`);
    lines.push(`hang→idle=${s.chains?.["hang→idle"] ?? 0} perch→hang=${s.chains?.["perch→hang"] ?? 0}`);
    lines.push(`loops=${JSON.stringify(s.perceptualLoops ?? {})}`);
    lines.push("NOTE: ne pas confondre avec la simulation 5k ci-dessus.");
  } else {
    lines.push("(pas de runtime-session.json — section simulation only)");
  }
  lines.push("");

  lines.push("INVENTORY TABLE");
  lines.push("---------------");
  lines.push("| Information | Existe ? | Source | Brain ? | Utilisée ? |");
  lines.push("|---|---|---|---|---|");
  for (const r of inv) {
    lines.push(`| ${r.info} | ${r.exists} | ${r.source} | ${r.brain} | ${r.used} |`);
  }
  lines.push("");

  lines.push("ACCESSIBLE CONTEXT");
  lines.push("------------------");
  lines.push("BrainContext: body, cursor, world, userActivity, interpretedContext, needs, memory, stateId, idleSeconds, hour");
  lines.push("World: nearestEdge, nearestWindow, points, width/height, monitors, windows[]");
  lines.push("Unused but present:");
  for (const u of accessibleUnused()) lines.push(`• ${u}`);
  lines.push("");

  lines.push("MISSING CONTEXT");
  lines.push("---------------");
  for (const m of missingContext()) lines.push(`• ${m}`);
  lines.push("");
  lines.push("PROPOSED EnvironmentContext (NOT implemented — Phase 9A):");
  lines.push(`\`\`\`ts
EnvironmentContext {
  screenWidth; screenHeight; x; y;
  distanceLeft; distanceRight; distanceTop; distanceBottom;
  nearLeftEdge; nearRightEdge; nearTopEdge; nearBottomEdge;
  nearCorner; onValidSurface; inVoid; nearWindow; nearPerch;
  cursorDistance; cursorMoving; cursorVelocity;
}
\`\`\``);
  lines.push("");

  lines.push("ROOT CAUSES");
  lines.push("-----------");
  lines.push("1. Pas d'EnvironmentContext — distances/bords non matérialisés pour scoring");
  lines.push("2. Surface = floor work-area ; perch/window = ancre held sans collision live");
  lines.push("3. ScreenBounds.atEdge mort (non branché Brain)");
  lines.push("4. Audio: placeholder null ; media = proxy app frontmost seulement");
  lines.push("5. goTo X-only : conscience verticale limitée hors fall/held");
  lines.push("6. Phase 8 a corrigé HANG orphelin (force IDLE) — risque hang long réduit, void logique reste");
  lines.push("");

  lines.push("P0");
  lines.push("--");
  lines.push("• (structurel) held/perch sans validation de surface live → void logique possible");
  lines.push("");
  lines.push("P1");
  lines.push("--");
  lines.push("• Distances edge / atEdge non utilisées → walk peut viser le clamp sans réaction perceptuelle");
  lines.push("• Pas de inVoid / onValidSurface riche");
  lines.push("• cursorApproaching/Leaving absents");
  lines.push("• Animation confusion / edge_peek manquantes pour rendre l'awareness lisible");
  lines.push("");
  lines.push("P2");
  lines.push("--");
  lines.push("• Audio réel non branché (media_watching proxy faible)");
  lines.push("• windows[] / monitors sous-utilisés");
  lines.push("• dismount sans anim dédiée");
  lines.push("");
  lines.push("P3");
  lines.push("--");
  lines.push("• nearCorner explicite");
  lines.push("• headbob musique");
  lines.push("• volume / track metadata");
  lines.push("");

  lines.push("RECOMMENDATIONS");
  lines.push("---------------");
  lines.push("1. Phase 9B: introduire EnvironmentContext dérivé (read-only) branché BrainContext — sans forcer Goals");
  lines.push("2. Soft factors: nearEdge / inVoid / cursorApproach comme modifiers 0.9–1.15 max");
  lines.push("3. Valider edge/window encore présents pendant HANG (invalidate déjà partiel sur goTo)");
  lines.push("4. Audio: prototype AppleScript Spotify/Music OU MediaRemote derrière flag, remplir audioPlaying");
  lines.push("5. Anims minimales: edge_peek, confused, dismount (+ réutiliser dance pour music)");
  lines.push("6. Ne PAS ajouter scheduler/quota ; s'appuyer sur novelty/chain/personality existants");
  lines.push("");

  lines.push("SIMULATION (5k picks, contextes rotatifs — PAS une session réelle)");
  lines.push("-------------------------------------------------------------------");
  lines.push(`picks scorés: ${sim.picks}`);
  const top = Object.entries(sim.dist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [id, n] of top) {
    lines.push(`  ${id}: ${n} (${((100 * n) / Math.max(1, sim.picks)).toFixed(1)}%)`);
  }
  lines.push("");

  lines.push("ANIMATION INVENTORY (manquantes / réutilisables — ne pas créer en 9A)");
  lines.push("--------------------------------------------------------------------");
  for (const a of anims) {
    lines.push(`[${a.priority}] ${a.category} / ${a.id}`);
    lines.push(`  why: ${a.why}`);
    lines.push(`  trigger: ${a.trigger}`);
    lines.push(`  conditions: ${a.conditions}`);
    lines.push(`  reusable: ${a.reusable}`);
    lines.push(`  newNeeded: ${a.newNeeded ? "oui" : "non"}`);
  }
  lines.push("");

  lines.push("BOUNDARY AUDIT (extrait)");
  lines.push("------------------------");
  lines.push(formatBoundaryReport(boundary));
  lines.push("");
  lines.push("=== END SOPHIE ENVIRONMENT AUDIT ===");
  return lines.join("\n");
}

// --- self-checks (no behavior change) --------------------------------------

function selfChecks(): void {
  const required = [
    "src/motion/ScreenBounds.ts",
    "src/input/CursorTracker.ts",
    "src/world/types.ts",
    "src/user/UserActivitySnapshot.ts",
    "src-tauri/src/lib.rs",
  ];
  for (const r of required) {
    if (!existsSync(join(ROOT, r))) {
      console.error(`FAIL missing ${r}`);
      process.exit(1);
    }
  }
  // Ensure we did not invent audio APIs in tree
  const lib = src("src-tauri/src/lib.rs");
  if (/now_playing|get_volume|media_remote/i.test(lib)) {
    console.log("note — unexpected media command registered");
  }
  console.log("self-check: source inventory paths OK");
}

mkdirSync(CACHE, { recursive: true });
selfChecks();
const report = buildReport();
console.log(report);
writeFileSync(REPORT_PATH, report);
console.log(`\nRapport écrit: ${REPORT_PATH}`);
