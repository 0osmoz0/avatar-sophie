/**
 * Audit pipeline Brain → Goal → State → clip (33 animations séparées).
 * Observe / diagnostique uniquement — ne modifie pas les utilities.
 *
 * Usage: npx --yes tsx tools/animation-pipeline-audit.ts
 */

import { ANIMATION_IDS, type AnimationId } from "../src/assets/generated/animations";
import { ALL_CONSIDERATIONS } from "../src/behavior/considerations/catalog";
import type { BrainContext } from "../src/behavior/considerations/types";
import { Memory } from "../src/behavior/Memory";
import { Needs } from "../src/behavior/Needs";
import type { Body } from "../src/motion/Body";
import type { CursorTracker } from "../src/input/CursorTracker";
import type { WorldSnapshot } from "../src/world/types";
import { makeTestSnapshot } from "../src/user/UserActivitySnapshot";
import { interpretRules } from "../src/user/LocalContextInterpreter";
import type { Goal } from "../src/behavior/Goal";

type Counts = Record<string, number>;

type Access =
  | "brain"
  | "brain+user"
  | "user"
  | "chain"
  | "physics"
  | "orphan";

interface AnimRow {
  clip: AnimationId;
  state: string;
  access: Access;
  trigger: string;
  consideration: string;
  path: string;
  problemHint: string;
}

/** Inventaire statique — câblage réel du code (pas de correction). */
const INVENTORY: AnimRow[] = [
  {
    clip: "idle",
    state: "IDLE",
    access: "brain",
    trigger: "Consideration idle / fin d'activité",
    consideration: "idle",
    path: "idle → idle → IDLE → idle",
    problemHint: "",
  },
  {
    clip: "walk",
    state: "WALK",
    access: "brain",
    trigger: "goTo (walk/perch/window) + selectAnimation",
    consideration: "walk|perch|window",
    path: "walk|perch|window → goTo → WALK → walk",
    problemHint: "souvent trop fréquente (locomotion)",
  },
  {
    clip: "run",
    state: "RUN (non enregistré)",
    access: "physics",
    trigger: "selectAnimation si speed ≥ RUN_THRESHOLD",
    consideration: "— (cursor chase / goTo rapide)",
    path: "reactCursor chase|goTo → followBody → selectAnimation → run",
    problemHint: "State RUN absent de createAllStates ; clip via physique",
  },
  {
    clip: "look_around",
    state: "LOOK_AROUND",
    access: "brain",
    trigger: "Consideration look",
    consideration: "look",
    path: "look → activity LOOK_AROUND → look_around",
    problemHint: "",
  },
  {
    clip: "yawn",
    state: "YAWN",
    access: "brain",
    trigger: "Consideration yawn | chaîne work→yawn | OVERWORK→YAWN",
    consideration: "yawn (+ then work)",
    path: "yawn|work.then → YAWN → yawn → (SLEEP si tired)",
    problemHint: "",
  },
  {
    clip: "sleep",
    state: "SLEEP",
    access: "brain+user",
    trigger: "Consideration sleep | tray/prompt | YAWN→SLEEP",
    consideration: "sleep",
    path: "sleep → SLEEP → sleep",
    problemHint: "",
  },
  {
    clip: "coffee",
    state: "COFFEE",
    access: "brain+user",
    trigger: "Consideration coffee | then work | tray/prompt",
    consideration: "coffee",
    path: "coffee|work.then → COFFEE → coffee",
    problemHint: "",
  },
  {
    clip: "work",
    state: "WORK",
    access: "brain+user",
    trigger: "Consideration work | prompt (aléatoire vs work_alt)",
    consideration: "work",
    path: "work → WORK → work|work_alt (anti-répétition)",
    problemHint: "",
  },
  {
    clip: "work_alt",
    state: "WORK",
    access: "brain+user",
    trigger: "Variante aléatoire de WORK",
    consideration: "work",
    path: "work → WORK → work_alt",
    problemHint: "jamais choisie explicitement par le Brain — pool State",
  },
  {
    clip: "overwork",
    state: "OVERWORK",
    access: "chain",
    trigger: "WORK + needs.exhausted",
    consideration: "— (conséquence WORK)",
    path: "work → WORK → exhausted → OVERWORK → overwork → YAWN",
    problemHint: "dépend d'exhausted pendant WORK",
  },
  {
    clip: "study",
    state: "STUDY",
    access: "brain+user",
    trigger: "Consideration study | prompt",
    consideration: "study",
    path: "study → STUDY → study",
    problemHint: "",
  },
  {
    clip: "eat",
    state: "EAT",
    access: "brain+user",
    trigger: "Consideration eat (mealBand) | prompt",
    consideration: "eat",
    path: "eat → EAT → eat",
    problemHint: "utility=0 hors 7–9 / 12–13 / 19–20h",
  },
  {
    clip: "think",
    state: "THINK",
    access: "brain",
    trigger: "Consideration think",
    consideration: "think",
    path: "think → THINK → think",
    problemHint: "",
  },
  {
    clip: "dance1",
    state: "DANCE",
    access: "brain+user",
    trigger: "Consideration dance | tray/prompt (pool 1–6)",
    consideration: "dance",
    path: "dance → DANCE → dance1–6 (anti-répétition)",
    problemHint: "",
  },
  {
    clip: "dance2",
    state: "DANCE",
    access: "brain+user",
    trigger: "idem",
    consideration: "dance",
    path: "dance → DANCE → dance2",
    problemHint: "",
  },
  {
    clip: "dance3",
    state: "DANCE",
    access: "brain+user",
    trigger: "idem",
    consideration: "dance",
    path: "dance → DANCE → dance3",
    problemHint: "",
  },
  {
    clip: "dance4",
    state: "DANCE",
    access: "brain+user",
    trigger: "idem",
    consideration: "dance",
    path: "dance → DANCE → dance4",
    problemHint: "",
  },
  {
    clip: "dance5",
    state: "DANCE",
    access: "brain+user",
    trigger: "idem",
    consideration: "dance",
    path: "dance → DANCE → dance5",
    problemHint: "",
  },
  {
    clip: "dance6",
    state: "DANCE",
    access: "brain+user",
    trigger: "idem",
    consideration: "dance",
    path: "dance → DANCE → dance6",
    problemHint: "",
  },
  {
    clip: "hang",
    state: "HANG",
    access: "brain+user",
    trigger: "perch.then | tray/prompt hang",
    consideration: "perch",
    path: "perch → goTo → perch → HANG → hang → fall?|dismount",
    problemHint: "échec goTo possible si edge trop loin",
  },
  {
    clip: "fall",
    state: "FALL",
    access: "brain+user",
    trigger: "perch→fall ~32–67% | drag release | selectAnimation !grounded",
    consideration: "perch (then fall) / user / physics",
    path: "perch→fall | user DRAG→FALL | physics → fall",
    problemHint: "",
  },
  {
    clip: "surprise",
    state: "CURSOR_NOTICE | SURPRISE",
    access: "brain",
    trigger: "cursor notice | notifyLanded→recover SURPRISE",
    consideration: "cursor | recover (forcé landed)",
    path: "cursor→CURSOR_NOTICE→surprise | land→SURPRISE→surprise",
    problemHint: "recoverFall hors ALL_CONSIDERATIONS (forcé landed)",
  },
  {
    clip: "chase",
    state: "CURSOR_CHASE",
    access: "brain",
    trigger: "cursor chase si curious+moving+dist<220",
    consideration: "cursor",
    path: "cursor → reactCursor chase → CURSOR_CHASE → chase|run",
    problemHint: "rare (cooldown + concurrence + focus)",
  },
  {
    clip: "push",
    state: "PUSH",
    access: "brain",
    trigger: "window.then mime (biais curiosity)",
    consideration: "window",
    path: "window → goTo → PUSH → push",
    problemHint: "",
  },
  {
    clip: "pull",
    state: "PULL",
    access: "brain",
    trigger: "window.then mime",
    consideration: "window",
    path: "window → goTo → PULL → pull",
    problemHint: "",
  },
  {
    clip: "happy",
    state: "PET | HAPPY | CURSOR_CHASE",
    access: "brain+user",
    trigger: "clic affection≥50 | consideration happy | chase proche",
    consideration: "happy / cursor / user",
    path: "PET|HAPPY→happy | chase→happy | happy→HAPPY",
    problemHint: "",
  },
  {
    clip: "wave",
    state: "WAVE",
    access: "user",
    trigger: "double-clic",
    consideration: "—",
    path: "user double-clic → WAVE → wave",
    problemHint: "inaccessible Brain",
  },
  {
    clip: "love",
    state: "LOVE",
    access: "user",
    trigger: "prompt contextuel love",
    consideration: "—",
    path: "user prompt → LOVE → love",
    problemHint: "inaccessible Brain",
  },
  {
    clip: "drag",
    state: "DRAG",
    access: "user",
    trigger: "glisser-déposer",
    consideration: "—",
    path: "user drag → DRAG → drag",
    problemHint: "inaccessible Brain",
  },
  {
    clip: "angry",
    state: "POKE | ANGRY",
    access: "brain+user",
    trigger: "consideration angry | hold poke",
    consideration: "angry",
    path: "angry → ANGRY → angry | user POKE → angry",
    problemHint: "",
  },
  {
    clip: "excited",
    state: "EXCITED",
    access: "brain",
    trigger: "consideration excited (playful)",
    consideration: "excited",
    path: "excited → EXCITED → excited",
    problemHint: "",
  },
  {
    clip: "crying",
    state: "CRYING",
    access: "brain",
    trigger: "consideration crying (rare)",
    consideration: "crying",
    path: "crying → CRYING → crying",
    problemHint: "",
  },
  {
    clip: "blow_kiss",
    state: "BLOW_KISS",
    access: "brain+user",
    trigger: "clic affection haute | consideration blow_kiss",
    consideration: "blow_kiss",
    path: "blow_kiss → BLOW_KISS → blow_kiss | user clic",
    problemHint: "",
  },
];

function worldBase(opts: {
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  windowDist?: number;
  edgeOffset?: number;
}): WorldSnapshot {
  const bodyX = opts.bodyX ?? 600;
  const wd = opts.windowDist ?? 120;
  return {
    originX: 0,
    originY: 0,
    width: 1400,
    height: 900,
    scaleFactor: 2,
    monitors: [],
    windows: [],
    points: [
      { kind: "floor", x: 300, y: 900 },
      { kind: "floor", x: 700, y: 900 },
      { kind: "corner", x: 50, y: 900 },
    ],
    nearestWindow: opts.window
      ? {
          id: 1,
          title: "App",
          x: bodyX + wd - 180,
          y: 120,
          width: 360,
          height: 280,
        }
      : null,
    nearestEdge: opts.edge
      ? {
          x: bodyX + (opts.edgeOffset ?? 40),
          y: 180,
          facing: 1 as const,
          kind: "screen",
        }
      : null,
  } as WorldSnapshot;
}

function makeNeeds(p: Partial<Needs>): Needs {
  const n = new Needs();
  Object.assign(n, p);
  return n;
}

function ctxOf(opts: {
  needs: Needs;
  memory?: Memory;
  now?: number;
  hour?: number;
  idleSeconds?: number;
  window?: boolean;
  edge?: boolean;
  bodyX?: number;
  windowDist?: number;
  edgeOffset?: number;
  cursorNear?: boolean;
  cursorMoving?: boolean;
  user?: ReturnType<typeof makeTestSnapshot>;
}): BrainContext {
  const bodyX = opts.bodyX ?? 600;
  const world = worldBase(opts);
  const user =
    opts.user ??
    makeTestSnapshot({
      category: "unknown",
      overallActivity: 0.2,
      userBusy: false,
      userIdle: false,
      secondsSinceLastInput: 30,
    });
  const cursorX = opts.cursorNear ? bodyX + 80 : bodyX + 900;
  const cursorY = opts.cursorNear ? 820 : 100; // près de la tête (body.y - 80)
  return {
    now: opts.now ?? 1_000_000,
    body: { x: bodyX, y: 900 } as Body,
    cursor: {
      x: cursorX,
      y: cursorY,
      moving: opts.cursorMoving ?? false,
      idleSeconds: opts.cursorMoving ? 0 : 30,
      vx: opts.cursorMoving ? 40 : 0,
      vy: 0,
      distanceTo: (x: number, y: number) => Math.hypot(cursorX - x, cursorY - y),
    } as CursorTracker,
    needs: opts.needs,
    memory: opts.memory ?? new Memory(),
    world,
    userActivity: user,
    interpretedContext: interpretRules(user),
    stateId: "IDLE",
    idleSeconds: opts.idleSeconds ?? 10,
    hour: opts.hour ?? 15,
  };
}

function pickOnce(ctx: BrainContext): { id: string; u: number; goal: Goal } | null {
  const scored = ALL_CONSIDERATIONS.map((c) => ({
    c,
    u: c.utility(ctx) * (0.88 + Math.random() * 0.24),
    priority: c.priority ?? 0,
  }))
    .filter((s) => s.u > 0.05)
    .sort((a, b) => b.u - a.u || b.priority - a.priority);
  const top = scored[0];
  if (!top) return null;
  return { id: top.c.id, u: top.u, goal: top.c.buildGoal(ctx) };
}

/** Reproduit DanceState / ActivityState WORK (anti-répétition). */
let lastDance: string | null = null;
let lastWork: "work" | "work_alt" | null = null;

function pickDance(): AnimationId {
  const clips = ["dance1", "dance2", "dance3", "dance4", "dance5", "dance6"] as const;
  const pool = clips.filter((c) => c !== lastDance);
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? clips[0]!;
  lastDance = pick;
  return pick;
}

function pickWork(): AnimationId {
  const options = (["work", "work_alt"] as const).filter((c) => c !== lastWork);
  const pick = options[Math.floor(Math.random() * options.length)] ?? "work";
  lastWork = pick;
  return pick;
}

function bump(counts: Counts, clip: string, n = 1): void {
  counts[clip] = (counts[clip] ?? 0) + n;
}

/**
 * Étend un pick Brain en clips réellement joués (approximation pipeline).
 * Inclut locomotion walk, chaînes perch/window/cursor, variantes dance/work.
 */
function expandPickToClips(
  pickId: string,
  goal: Goal,
  ctx: BrainContext,
  clipCounts: Counts,
  considerationCounts: Counts,
): void {
  bump(considerationCounts, pickId);

  switch (pickId) {
    case "idle":
      bump(clipCounts, "idle");
      break;
    case "walk":
      bump(clipCounts, "walk");
      bump(clipCounts, "idle");
      break;
    case "look":
      bump(clipCounts, "look_around");
      break;
    case "work": {
      bump(clipCounts, pickWork());
      // Chaîne then YAWN/COFFEE si gates (approx : fatigue élevée)
      if (ctx.needs.tired || ctx.needs.fatigue >= 55) {
        bump(clipCounts, "yawn");
        if (ctx.needs.energy <= 45 || ctx.needs.fatigue >= 50) bump(clipCounts, "coffee");
      }
      // OVERWORK mid-session si déjà fatiguée (seuil ActivityState)
      if (
        ctx.needs.exhausted ||
        ctx.needs.fatigue >= 82 ||
        ctx.needs.energy <= 16 ||
        (ctx.needs.fatigue >= 60 && ctx.needs.energy <= 40)
      ) {
        bump(clipCounts, "overwork");
        bump(clipCounts, "yawn");
      }
      break;
    }
    case "study":
      bump(clipCounts, "study");
      break;
    case "coffee":
      bump(clipCounts, "coffee");
      break;
    case "eat":
      bump(clipCounts, "eat");
      break;
    case "think":
      bump(clipCounts, "think");
      break;
    case "dance":
      bump(clipCounts, pickDance());
      break;
    case "sleep":
      bump(clipCounts, "sleep");
      break;
    case "yawn":
      bump(clipCounts, "yawn");
      if (ctx.needs.tired) bump(clipCounts, "sleep");
      break;
    case "perch": {
      bump(clipCounts, "walk"); // goTo
      // Arrivée + gate approx
      const edge = ctx.world.nearestEdge;
      const near =
        edge && Math.abs(edge.x - (goal.kind === "goTo" ? goal.x : ctx.body.x)) < 420;
      if (near || edge) {
        bump(clipCounts, "hang");
        const fallChance =
          0.32 + (ctx.needs.boredom / 100) * 0.2 + (ctx.needs.curiosity / 100) * 0.15;
        if (Math.random() < fallChance) {
          bump(clipCounts, "fall");
          bump(clipCounts, "surprise"); // recover landed
        }
      }
      break;
    }
    case "window": {
      bump(clipCounts, "walk");
      if (goal.kind === "goTo" && goal.then?.kind === "activity") {
        const st = goal.then.state;
        if (st === "PUSH") bump(clipCounts, "push");
        else if (st === "PULL") bump(clipCounts, "pull");
      } else {
        // fallback si goal déjà construit
        bump(clipCounts, Math.random() < 0.5 ? "push" : "pull");
      }
      bump(clipCounts, "idle");
      break;
    }
    case "cursor": {
      if (goal.kind === "reactCursor" && goal.mode === "chase") {
        bump(clipCounts, "chase");
        bump(clipCounts, "run"); // followBody rapide → selectAnimation
        bump(clipCounts, "happy");
      } else {
        bump(clipCounts, "surprise"); // CURSOR_NOTICE
      }
      break;
    }
    case "angry":
      bump(clipCounts, "angry");
      break;
    case "excited":
      bump(clipCounts, "excited");
      break;
    case "crying":
      bump(clipCounts, "crying");
      break;
    case "blow_kiss":
      bump(clipCounts, "blow_kiss");
      break;
    case "happy":
      bump(clipCounts, "happy");
      break;
    default:
      bump(clipCounts, `(unknown:${pickId})`);
  }
}

type Profile = {
  name: string;
  build: (i: number) => BrainContext;
  n: number;
  seedMemory?: (mem: Memory, now: number) => void;
};

function runProfiles(profiles: Profile[]): {
  clipCounts: Counts;
  considerationCounts: Counts;
} {
  const clipCounts: Counts = {};
  const considerationCounts: Counts = {};
  const mem = new Memory();
  let now = 1_000_000;

  for (const profile of profiles) {
    for (let i = 0; i < profile.n; i++) {
      const ctx = profile.build(i);
      ctx.memory = mem;
      ctx.now = now;
      profile.seedMemory?.(mem, now);
      const pick = pickOnce(ctx);
      if (!pick) {
        bump(considerationCounts, "(none)");
        bump(clipCounts, "idle");
        now += 12_000;
        continue;
      }
      const cons = ALL_CONSIDERATIONS.find((c) => c.id === pick.id)!;
      mem.remember(pick.id, now, cons.cooldownMs ?? 30_000);
      expandPickToClips(pick.id, pick.goal, ctx, clipCounts, considerationCounts);

      // Drift needs léger
      if (pick.id === "walk") ctx.needs.boredom = Math.max(0, ctx.needs.boredom - 8);
      if (pick.id === "look") ctx.needs.curiosity = Math.max(0, ctx.needs.curiosity - 6);
      if (pick.id === "idle") ctx.needs.boredom = Math.min(100, ctx.needs.boredom + 3);

      now += 15_000 + Math.random() * 12_000;
    }
  }
  return { clipCounts, considerationCounts };
}

function pct(n: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((100 * n) / total).toFixed(1)}%`;
}

function diagnose(
  row: AnimRow,
  count: number,
  totalClips: number,
): { played: boolean; problem: string; abc: string } {
  const share = totalClips > 0 ? count / totalClips : 0;
  const played = count > 0;

  if (row.access === "orphan") {
    return { played: false, problem: "orpheline", abc: "A — Brain/user ne la choisit jamais" };
  }
  if (row.access === "user") {
    return {
      played: false,
      problem: "user-only (0 en simu Brain)",
      abc: "A — accessible uniquement utilisateur",
    };
  }
  if (!played) {
    if (row.clip === "overwork") {
      return {
        played: false,
        problem: "jamais (exhausted rare en simu)",
        abc: "A — condition Needs.exhausted pendant WORK",
      };
    }
    if (row.clip === "run") {
      return {
        played: false,
        problem: "physics non simulée ici",
        abc: "C/physique — selectAnimation (pas State RUN)",
      };
    }
    return {
      played: false,
      problem: "jamais jouée en simu",
      abc: "A à vérifier (utility/cooldown/préconditions)",
    };
  }
  if (row.clip === "walk" && share > 0.18) {
    return { played: true, problem: "trop fréquente", abc: "A — locomotion dans goTo" };
  }
  if (row.clip === "idle" && share > 0.2) {
    return { played: true, problem: "très fréquente", abc: "A — baseline + fins" };
  }
  if (row.problemHint.includes("ORPHELINE")) {
    return { played, problem: row.problemHint, abc: "A" };
  }
  return { played: true, problem: "—", abc: "OK" };
}

// ─── main ───────────────────────────────────────────────────────────

console.log("=== Inventaire assets ===");
console.log(`ANIMATION_IDS: ${ANIMATION_IDS.length}`);
const invClips = new Set(INVENTORY.map((r) => r.clip));
for (const id of ANIMATION_IDS) {
  if (!invClips.has(id)) console.log(`  MANQUANT inventaire: ${id}`);
}
for (const r of INVENTORY) {
  if (!(ANIMATION_IDS as readonly string[]).includes(r.clip)) {
    console.log(`  INVENTAIRE hors assets: ${r.clip}`);
  }
}

const N = 350;
const profiles: Profile[] = [
  {
    name: "inactif",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 85, fatigue: 15, boredom: 40, curiosity: 55 }),
        idleSeconds: 12,
        user: makeTestSnapshot({
          userIdle: true,
          secondsSinceLastInput: 400,
          overallActivity: 0.05,
        }),
      }),
  },
  {
    name: "fatiguée nuit",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 22, fatigue: 78, boredom: 25, curiosity: 40 }),
        hour: 23,
      }),
  },
  {
    name: "ennuyée",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 65, fatigue: 25, boredom: 82, curiosity: 60 }),
        idleSeconds: 15,
      }),
  },
  {
    name: "coding",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 55, fatigue: 48, boredom: 40, curiosity: 45 }),
        hour: 11,
        user: makeTestSnapshot({
          category: "coding",
          activeAppDurationSec: 50 * 60,
          overallActivity: 0.85,
          userBusy: true,
          secondsSinceLastInput: 2,
        }),
      }),
  },
  {
    name: "repas midi",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 45, fatigue: 30, boredom: 35, curiosity: 50 }),
        hour: 12,
      }),
  },
  {
    name: "fenêtre+bord",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 75, fatigue: 18, boredom: 70, curiosity: 75 }),
        idleSeconds: 20,
        window: true,
        windowDist: 100,
        edge: true,
        edgeOffset: 50,
      }),
  },
  {
    name: "cursor près",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({ energy: 70, fatigue: 20, boredom: 45, curiosity: 70, social: 60 }),
        cursorNear: true,
        cursorMoving: true,
      }),
  },
  {
    name: "exhausted work",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({
          // Assez fatiguée pour OVERWORK mid-session, pas encore bloquée au start
          energy: 35,
          fatigue: 70,
          boredom: 50,
          curiosity: 40,
        }),
        hour: 14,
      }),
  },
  {
    name: "playful excited",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({
          energy: 70,
          fatigue: 12,
          boredom: 75,
          curiosity: 72,
        }),
        idleSeconds: 10,
      }),
  },
  {
    name: "neglected angry",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({
          energy: 55,
          fatigue: 20,
          boredom: 70,
          curiosity: 40,
          affection: 18,
        }),
      }),
  },
  {
    name: "distressed crying",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({
          energy: 10,
          fatigue: 92,
          boredom: 30,
          curiosity: 35,
          affection: 22,
        }),
      }),
  },
  {
    name: "affectionate after pet",
    n: N,
    build: () =>
      ctxOf({
        needs: makeNeeds({
          energy: 70,
          fatigue: 15,
          boredom: 35,
          curiosity: 50,
          affection: 80,
          social: 62,
        }),
      }),
    seedMemory: (mem, now) => {
      mem.remember("pet", now);
    },
  },
  {
    name: "interrupted tired",
    n: Math.floor(N / 2),
    build: () =>
      ctxOf({
        needs: makeNeeds({
          energy: 28,
          fatigue: 70,
          boredom: 40,
          curiosity: 40,
          affection: 32,
        }),
      }),
    seedMemory: (mem, now) => {
      mem.remember("interrupted", now);
    },
  },
];

const { clipCounts, considerationCounts } = runProfiles(profiles);
const totalClips = Object.values(clipCounts).reduce((a, b) => a + b, 0);
const totalCons = Object.values(considerationCounts).reduce((a, b) => a + b, 0);

console.log(`\n=== Considerations (~${totalCons} picks) ===`);
for (const [k, v] of Object.entries(considerationCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(14)} ${String(v).padStart(5)}  ${pct(v, totalCons)}`);
}

console.log(`\n=== Clips simulés (~${totalClips} transitions) ===`);
console.log(
  "| Animation | Accessible | Déclencheur | Jouée | Count | % | Problème | ABC |",
);
console.log(
  "| --------- | ---------- | ----------- | ----- | ----: | --: | -------- | --- |",
);

for (const row of INVENTORY) {
  const count = clipCounts[row.clip] ?? 0;
  const { played, problem, abc } = diagnose(row, count, totalClips);
  const accessIcon =
    row.access === "orphan"
      ? "❌"
      : row.access === "user"
        ? "👤"
        : row.access === "physics" || row.access === "chain"
          ? "⚡"
          : "✅";
  console.log(
    `| ${row.clip.padEnd(11)} | ${accessIcon.padEnd(10)} | ${row.consideration.padEnd(11)} | ${
      played ? "✅" : "❌"
    } | ${String(count).padStart(5)} | ${pct(count, totalClips).padStart(6)} | ${problem} | ${abc} |`,
  );
}

console.log(`\n=== Chemins critiques ===`);
for (const clip of [
  "dance1",
  "dance2",
  "dance3",
  "dance4",
  "dance5",
  "dance6",
  "work",
  "work_alt",
  "hang",
  "fall",
  "surprise",
  "push",
  "pull",
  "yawn",
  "coffee",
  "eat",
  "sleep",
  "think",
  "study",
  "chase",
  "overwork",
  "angry",
  "excited",
  "crying",
  "blow_kiss",
] as AnimationId[]) {
  const row = INVENTORY.find((r) => r.clip === clip)!;
  const c = clipCounts[clip] ?? 0;
  console.log(
    `${clip.padEnd(12)} n=${String(c).padStart(4)}  ${row.path}`,
  );
}

const never = INVENTORY.filter((r) => (clipCounts[r.clip] ?? 0) === 0).map((r) => r.clip);
const orphans = INVENTORY.filter((r) => r.access === "orphan").map((r) => r.clip);
const userOnly = INVENTORY.filter((r) => r.access === "user").map((r) => r.clip);
const frequent = INVENTORY.filter((r) => {
  const c = clipCounts[r.clip] ?? 0;
  return totalClips > 0 && c / totalClips > 0.12;
}).map((r) => `${r.clip}(${pct(clipCounts[r.clip]!, totalClips)})`);

console.log(`\n=== Synthèse ===`);
console.log(`Jamais jouées (simu Brain): ${never.join(", ") || "—"}`);
console.log(`Orphelines (aucun déclencheur): ${orphans.join(", ")}`);
console.log(`User-only: ${userOnly.join(", ")}`);
console.log(`Trop fréquentes (>12%): ${frequent.join(", ") || "—"}`);
console.log(`\nNote: simu = décision Brain + expansion State/clip.`);
console.log(`run/physics et interactions user = 0 ici (attendu).`);
console.log(`Runtime réel: localStorage.sophieDebugBrain=1 → logs [Anim] + Sophie.animationCounts`);
