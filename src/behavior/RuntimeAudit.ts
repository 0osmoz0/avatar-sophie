/**
 * Audit runtime (Phase 5) — observation uniquement.
 *
 * Activer : localStorage.sophieDebugRuntime = "1" ou Sophie.debugRuntime = true.
 * Ne modifie aucune décision / utility / cooldown.
 */

import type { AnimSource } from "./BrainDebug";
import type { Memory } from "./Memory";

export interface RuntimeChainStep {
  event?: string;
  memory?: string;
  consideration?: string;
  goal?: string;
  state?: string;
  clip?: string;
  note?: string;
}

export interface RuntimeReport {
  events: Record<string, number>;
  deferred: Record<string, number>;
  interruptions: Record<string, number>;
  chains: Record<string, number>;
  emotions: Record<string, number>;
  cursor: Record<string, number>;
  memory: {
    pet: number;
    poke: number;
    wave: number;
    love: number;
    user_returned: number;
    user_became_idle: number;
    user_became_busy: number;
    happy: number;
    blow_kiss: number;
    lastPositive: number;
    lastFrustration: number;
  };
  animBySource: Record<string, number>;
  stateTransitions: Array<{ from: string; to: string }>;
  goalPicks: Array<{ pick: string; reason: string }>;
  invalid: string[];
  traces: RuntimeChainStep[];
}

function flagEnabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.Sophie?.debugRuntime) return true;
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("sophieDebugRuntime") === "1";
    }
  } catch {
    /* ignore */
  }
  return false;
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

const BUSY_INTERRUPT_KEYS = [
  "WORK",
  "SLEEP",
  "DANCE",
  "COFFEE",
  "STUDY",
  "OVERWORK",
] as const;

function emptyReport(): RuntimeReport {
  return {
    events: {},
    deferred: {},
    interruptions: Object.fromEntries(BUSY_INTERRUPT_KEYS.map((k) => [`${k} interrupted`, 0])),
    chains: {
      "work→yawn": 0,
      "yawn→coffee": 0,
      "look→window": 0,
      "look→perch": 0,
      "perch→hang": 0,
      "hang→fall": 0,
      "fall→surprise": 0,
      "think→work": 0,
      "think→study": 0,
      "work→overwork": 0,
      "overwork→yawn": 0,
      "yawn→sleep": 0,
      "sleep→idle": 0,
    },
    emotions: {
      happy: 0,
      angry: 0,
      excited: 0,
      crying: 0,
      blow_kiss: 0,
    },
    cursor: { notice: 0, chase: 0, run: 0 },
    memory: {
      pet: 0,
      poke: 0,
      wave: 0,
      love: 0,
      user_returned: 0,
      user_became_idle: 0,
      user_became_busy: 0,
      happy: 0,
      blow_kiss: 0,
      lastPositive: 0,
      lastFrustration: 0,
    },
    animBySource: {},
    stateTransitions: [],
    goalPicks: [],
    invalid: [],
    traces: [],
  };
}

let report = emptyReport();
let lastState: string | null = null;
let lastPick: string | null = null;
let lastGoalLabel: string | null = null;

function patchSophie(): void {
  if (typeof window === "undefined") return;
  window.Sophie = {
    ...window.Sophie,
    runtimeReport: snapshot(),
    runtimeAudit: RuntimeAudit,
  };
}

function snapshot(): RuntimeReport {
  return structuredClone(report);
}

function logLine(message: string): void {
  if (!flagEnabled()) return;
  console.log(`[Runtime] ${message}`);
}

export const RuntimeAudit = {
  enabled(): boolean {
    return flagEnabled();
  },

  reset(): void {
    report = emptyReport();
    lastState = null;
    lastPick = null;
    lastGoalLabel = null;
    patchSophie();
  },

  /** Interaction pointeur (pet/poke/wave/love). */
  interaction(opts: {
    kind: string;
    stateId: string;
    deferred: boolean;
    immediateState: string | null;
    suppressReason?: string;
    memory?: Memory;
    now?: number;
  }): void {
    bump(report.events, opts.kind);
    const mem = opts.memory;
    const pos = mem?.recentPositiveInteraction ?? 0;
    const fr = mem?.recentFrustration ?? 0;

    logLine(`interaction=${opts.kind}`);
    logLine(`state=${opts.stateId}`);
    if (opts.deferred) {
      logLine(`action=deferred`);
      bump(report.deferred, `${opts.kind} while busy`);
    } else if (opts.immediateState) {
      logLine(`action=immediate state=${opts.immediateState}`);
    } else {
      logLine(`action=suppress reason=${opts.suppressReason ?? "none"}`);
    }
    if (mem) {
      logLine(
        `memory=${opts.kind} positive=${pos.toFixed(2)} frustration=${fr.toFixed(2)}`,
      );
      report.memory.lastPositive = pos;
      report.memory.lastFrustration = fr;
    }

    report.traces.push({
      event: opts.kind,
      memory: opts.deferred ? `${opts.kind} (deferred)` : opts.kind,
      state: opts.immediateState ?? opts.stateId,
      note: opts.suppressReason,
    });
    patchSophie();
  },

  /** Signal user activity → Memory. */
  userSignal(kind: "user_returned" | "user_became_idle" | "user_became_busy", mem?: Memory): void {
    bump(report.events, kind);
    bump(report.memory, kind);
    logLine(`signal=${kind}`);
    if (mem) {
      logLine(
        `memory=${kind} positive=${mem.recentPositiveInteraction.toFixed(2)} ` +
          `activity=${mem.recentActivity.toFixed(2)}`,
      );
      report.memory.lastPositive = mem.recentPositiveInteraction;
    }
    report.traces.push({ event: kind, memory: kind });
    patchSophie();
  },

  /** Label mémorisé (pet, happy, interrupted…). */
  remembered(label: string, mem?: Memory): void {
    const countKeys = [
      "pet",
      "poke",
      "wave",
      "love",
      "user_returned",
      "user_became_idle",
      "user_became_busy",
      "happy",
      "blow_kiss",
    ] as const;
    if ((countKeys as readonly string[]).includes(label)) {
      const k = label as (typeof countKeys)[number];
      report.memory[k] += 1;
    }
    if (mem) {
      report.memory.lastPositive = mem.recentPositiveInteraction;
      report.memory.lastFrustration = mem.recentFrustration;
    }
  },

  state(from: string | null, to: string): void {
    if (from === to) return;
    if (from) {
      report.stateTransitions.push({ from, to });
      logLine(`state=${from} → ${to}`);
      noteStateChain(from, to);
    } else {
      logLine(`state=${to}`);
    }
    lastState = to;

    const emo = to.toLowerCase();
    if (emo in report.emotions) bump(report.emotions, emo);

    if (to === "CURSOR_NOTICE") bump(report.cursor, "notice");
    if (to === "CURSOR_CHASE") bump(report.cursor, "chase");

    patchSophie();
  },

  decide(pick: string, reason: string, previous?: string | null): void {
    lastPick = pick;
    report.goalPicks.push({ pick, reason });
    bump(report.events, `pick:${pick}`);

    if (previous === "think" && (pick === "work" || pick === "study")) {
      bump(report.chains, `think→${pick}`);
    }
    if (previous === "look" && (pick === "window" || pick === "perch")) {
      bump(report.chains, `look→${pick}`);
    }
    if (previous === "work" && pick === "yawn") bump(report.chains, "work→yawn");
    if (previous === "yawn" && pick === "coffee") bump(report.chains, "yawn→coffee");
    if (previous === "yawn" && pick === "sleep") bump(report.chains, "yawn→sleep");

    // BrainDebug gère déjà [Brain] pick=… — ici on complète la chaîne.
    if (flagEnabled()) {
      console.log(
        `[Runtime] decide pick=${pick}` +
          (previous ? ` previous=${previous}` : "") +
          ` goal=${pick}`,
      );
    }
    report.traces.push({
      consideration: pick,
      goal: pick,
      note: reason.slice(0, 120),
    });
    lastGoalLabel = pick;
    patchSophie();
  },

  setGoal(label: string): void {
    lastGoalLabel = label;
    logLine(`goal=${label}`);
    report.traces.push({ goal: label, consideration: lastPick ?? undefined });
    patchSophie();
  },

  anim(state: string, clip: string, source: AnimSource): void {
    bump(report.animBySource, `${source}:${clip}`);
    if (clip === "run") bump(report.cursor, "run");
    if (clip in report.emotions) bump(report.emotions, clip);

    if (lastGoalLabel === "perch" && (state === "HANG" || clip === "hang")) {
      bump(report.chains, "perch→hang");
    }
    if (state === "FALL" || clip === "fall") {
      if (lastState === "HANG") bump(report.chains, "hang→fall");
    }
    if (state === "SURPRISE" || clip === "surprise") {
      if (lastState === "FALL" || lastState === "IDLE") bump(report.chains, "fall→surprise");
    }
    if (state === "OVERWORK") bump(report.chains, "work→overwork");
    if (state === "YAWN" && lastState === "OVERWORK") bump(report.chains, "overwork→yawn");
    if (state === "IDLE" && lastState === "SLEEP") bump(report.chains, "sleep→idle");

    report.traces.push({
      state,
      clip,
      goal: lastGoalLabel ?? undefined,
      consideration: lastPick ?? undefined,
    });
    patchSophie();
  },

  /**
   * Interruption potentielle d'un BUSY_STATE.
   * PET/POKE différés ne comptent PAS — seulement force clear / request.
   */
  interruption(stateId: string, kind: string, forced: boolean): void {
    if (!forced) return;
    const key = `${stateId} interrupted`;
    if (key in report.interruptions) {
      bump(report.interruptions, key);
      report.invalid.push(`forced interrupt ${stateId} via ${kind}`);
      logLine(`INVALID interrupt=${stateId} kind=${kind}`);
    }
    patchSophie();
  },

  invalid(msg: string): void {
    report.invalid.push(msg);
    logLine(`INVALID ${msg}`);
    patchSophie();
  },

  report(): RuntimeReport {
    return snapshot();
  },

  formatReport(r: RuntimeReport = snapshot()): string {
    const lines: string[] = [];
    const section = (title: string) => {
      lines.push("");
      lines.push(title);
      lines.push("-".repeat(title.length));
    };
    const dump = (obj: Record<string, number>) => {
      for (const [k, v] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${k}: ${v}`);
      }
    };

    lines.push("=== RUNTIME BEHAVIOR AUDIT ===");

    section("Events");
    dump(r.events);

    section("Deferred interactions");
    if (Object.keys(r.deferred).length === 0) lines.push("(none)");
    else dump(r.deferred);

    section("Interruptions interdites");
    dump(r.interruptions);

    section("Chains");
    dump(r.chains);

    section("Emotions");
    dump(r.emotions);

    section("Cursor");
    dump(r.cursor);

    section("Memory");
    lines.push(`pet remembered: ${r.memory.pet}`);
    lines.push(`poke remembered: ${r.memory.poke}`);
    lines.push(`wave remembered: ${r.memory.wave}`);
    lines.push(`love remembered: ${r.memory.love}`);
    lines.push(`user_returned: ${r.memory.user_returned}`);
    lines.push(`user_became_idle: ${r.memory.user_became_idle}`);
    lines.push(`user_became_busy: ${r.memory.user_became_busy}`);
    lines.push(`happy: ${r.memory.happy}`);
    lines.push(`blow_kiss: ${r.memory.blow_kiss}`);
    lines.push(`positive trend: ${r.memory.lastPositive.toFixed(2)}`);
    lines.push(`frustration trend: ${r.memory.lastFrustration.toFixed(2)}`);

    section("Invalid transitions");
    if (r.invalid.length === 0) lines.push("(none)");
    else for (const x of r.invalid) lines.push(`• ${x}`);

    lines.push("");
    lines.push("=== END RUNTIME AUDIT ===");
    return lines.join("\n");
  },
};

function noteStateChain(from: string, to: string): void {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  const key = `${a}→${b}`;
  const watched = [
    "work→yawn",
    "yawn→coffee",
    "yawn→sleep",
    "overwork→yawn",
    "hang→fall",
    "fall→surprise",
    "sleep→idle",
    "work→overwork",
  ];
  if (watched.includes(key)) bump(report.chains, key);
  if (from === "WORK" && to === "OVERWORK") bump(report.chains, "work→overwork");
  if (from === "HANG" && to === "FALL") bump(report.chains, "hang→fall");
  if (from === "FALL" && to === "SURPRISE") bump(report.chains, "fall→surprise");
  if (from === "YAWN" && to === "COFFEE") bump(report.chains, "yawn→coffee");
  if (from === "YAWN" && to === "SLEEP") bump(report.chains, "yawn→sleep");
  if (from === "WORK" && to === "YAWN") bump(report.chains, "work→yawn");
  if (from === "OVERWORK" && to === "YAWN") bump(report.chains, "overwork→yawn");
  if (from === "SLEEP" && to === "IDLE") bump(report.chains, "sleep→idle");
}
