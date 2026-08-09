/**
 * Audit runtime (Phase 5–7) — observation uniquement.
 *
 * Activer logs : localStorage.sophieDebugRuntime = "1" ou Sophie.debugRuntime = true.
 * Session longue : Sophie.runtimeAudit.exportSession() / formatSessionReport()
 * Persist auto (Tauri) → tools/.audit-cache/runtime-session.json
 *
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

export type BehaviorFamily =
  | "locomotion"
  | "calm"
  | "focus"
  | "explore"
  | "rest"
  | "social"
  | "emotion"
  | "unknown";

export interface PersonalitySnapEntry {
  at: number;
  tag: string;
  playful: number;
  social: number;
  curiosity: number;
  calm: number;
  independence: number;
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

/** Export session longue (Phase 7). */
export interface SessionExport {
  sessionStart: number;
  sessionDurationMs: number;
  pickCount: number;
  interactionCount: number;
  deferredInteractionCount: number;
  emotionCount: number;
  locomotionCount: number;
  focusCount: number;
  exploreCount: number;
  restCount: number;
  calmCount: number;
  socialCount: number;
  animCount: number;
  distribution: Record<string, number>;
  families: Record<string, number>;
  emotions: Record<string, number>;
  longestIdleMs: number;
  longestActivityMs: number;
  /** Phase 8 — rythme */
  softWakeCount: number;
  softWakeWhileBusy: number;
  busyPreserved: number;
  redecisionsWhileBusy: number;
  avgDecisionIntervalMs: number;
  decisionIntervals: number;
  topTransitions: Array<{ key: string; n: number }>;
  perceptualLoops: Record<string, number>;
  deferred: Record<string, number>;
  personalitySnapshots: PersonalitySnapEntry[];
  interruptions: Record<string, number>;
  cursor: Record<string, number>;
  chains: Record<string, number>;
  invalid: string[];
  observations: string[];
}

const FAMILY: Record<string, BehaviorFamily> = {
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
};

const PERCEPTUAL_LOOPS = [
  "walk→look→walk",
  "look→walk→look",
  "look→idle→look",
  "idle→look→idle",
  "idle→think→idle",
  "think→idle→think",
] as const;

const SESSION_PERSIST_PATH =
  "/Users/admin/Documents/GitHub/avatar-sophie/tools/.audit-cache/runtime-session.json";

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

let sessionStart = Date.now();
let pickCount = 0;
let interactionCount = 0;
let deferredInteractionCount = 0;
let animCount = 0;
const distribution: Record<string, number> = {};
const families: Record<string, number> = {};
const transitionCounts: Record<string, number> = {};
const perceptualLoops: Record<string, number> = Object.fromEntries(
  PERCEPTUAL_LOOPS.map((k) => [k, 0]),
);
const pickHistory: string[] = [];
const personalitySnapshots: PersonalitySnapEntry[] = [];

let stateEnteredAt = Date.now();
let longestIdleMs = 0;
let longestActivityMs = 0;
let lastPersistAt = 0;
let lastContextTag = "";
let softWakeCount = 0;
let softWakeWhileBusy = 0;
let busyPreserved = 0;
let redecisionsWhileBusy = 0;
let lastDecideAt = 0;
let decideIntervalSum = 0;
let decideIntervalCount = 0;
let persistHandler: ((path: string, contents: string) => Promise<void>) | null =
  null;

function familyOf(id: string): BehaviorFamily {
  return FAMILY[id] ?? "unknown";
}

function patchSophie(): void {
  if (typeof window === "undefined") return;
  window.Sophie = {
    ...window.Sophie,
    runtimeReport: snapshot(),
    runtimeAudit: RuntimeAudit,
    lastSessionExport: RuntimeAudit.exportSession(),
  };
}

function snapshot(): RuntimeReport {
  return structuredClone(report);
}

function logLine(message: string): void {
  if (!flagEnabled()) return;
  console.log(`[Runtime] ${message}`);
}

function closeStateDuration(nextState: string): void {
  const now = Date.now();
  const dur = now - stateEnteredAt;
  const prev = lastState;
  if (prev === "IDLE" || prev === null) {
    if (dur > longestIdleMs) longestIdleMs = dur;
  } else if (prev) {
    if (dur > longestActivityMs) longestActivityMs = dur;
  }
  stateEnteredAt = now;
  void nextState;
}

function notePerceptualLoops(): void {
  if (pickHistory.length < 3) return;
  const a = pickHistory[pickHistory.length - 3]!;
  const b = pickHistory[pickHistory.length - 2]!;
  const c = pickHistory[pickHistory.length - 1]!;
  const key = `${a}→${b}→${c}`;
  if (key in perceptualLoops) bump(perceptualLoops, key);
}

function maybePersist(force = false): void {
  const now = Date.now();
  if (!force && now - lastPersistAt < 30_000 && pickCount % 8 !== 0) return;
  lastPersistAt = now;
  const json = JSON.stringify(RuntimeAudit.exportSession(), null, 2);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sophieRuntimeSession", json);
    }
  } catch {
    /* ignore storage limit */
  }
  if (persistHandler) {
    void persistHandler(SESSION_PERSIST_PATH, json).catch(() => {
      /* ignore */
    });
  }
}

function snapPersonality(tag: string, mem?: Memory): void {
  if (!mem || typeof mem.personalitySnapshot !== "function") return;
  if (personalitySnapshots.length >= 40) personalitySnapshots.shift();
  const s = mem.personalitySnapshot();
  personalitySnapshots.push({
    at: Date.now(),
    tag,
    playful: s.playful,
    social: s.social,
    curiosity: s.curiosity,
    calm: s.calm,
    independence: s.independence,
  });
}

export const RuntimeAudit = {
  enabled(): boolean {
    return flagEnabled();
  },

  /** Enregistre un writer fichier (Tauri) — observation only. */
  setPersistHandler(
    handler: ((path: string, contents: string) => Promise<void>) | null,
  ): void {
    persistHandler = handler;
  },

  reset(): void {
    report = emptyReport();
    lastState = null;
    lastPick = null;
    lastGoalLabel = null;
    sessionStart = Date.now();
    pickCount = 0;
    interactionCount = 0;
    deferredInteractionCount = 0;
    animCount = 0;
    for (const k of Object.keys(distribution)) delete distribution[k];
    for (const k of Object.keys(families)) delete families[k];
    for (const k of Object.keys(transitionCounts)) delete transitionCounts[k];
    for (const k of PERCEPTUAL_LOOPS) perceptualLoops[k] = 0;
    pickHistory.length = 0;
    personalitySnapshots.length = 0;
    stateEnteredAt = Date.now();
    longestIdleMs = 0;
    longestActivityMs = 0;
    lastPersistAt = 0;
    lastContextTag = "";
    softWakeCount = 0;
    softWakeWhileBusy = 0;
    busyPreserved = 0;
    redecisionsWhileBusy = 0;
    lastDecideAt = 0;
    decideIntervalSum = 0;
    decideIntervalCount = 0;
    patchSophie();
  },

  noteContext(mode: string, mem?: Memory): void {
    if (mode === lastContextTag) return;
    lastContextTag = mode;
    if (mode === "focused_work" || mode === "idle_away" || mode === "gaming") {
      snapPersonality(mode, mem);
    }
  },

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
    interactionCount += 1;
    const mem = opts.memory;
    const pos = mem?.recentPositiveInteraction ?? 0;
    const fr = mem?.recentFrustration ?? 0;

    logLine(`interaction=${opts.kind}`);
    logLine(`state=${opts.stateId}`);
    if (opts.deferred) {
      logLine(`action=deferred`);
      bump(report.deferred, `${opts.kind} while busy`);
      deferredInteractionCount += 1;
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
      snapPersonality(`after:${opts.kind}`, mem);
    }

    report.traces.push({
      event: opts.kind,
      memory: opts.deferred ? `${opts.kind} (deferred)` : opts.kind,
      state: opts.immediateState ?? opts.stateId,
      note: opts.suppressReason,
    });
    patchSophie();
    maybePersist();
  },

  userSignal(
    kind: "user_returned" | "user_became_idle" | "user_became_busy",
    mem?: Memory,
  ): void {
    bump(report.events, kind);
    bump(report.memory, kind);
    logLine(`signal=${kind}`);
    if (mem) {
      logLine(
        `memory=${kind} positive=${mem.recentPositiveInteraction.toFixed(2)} ` +
          `activity=${mem.recentActivity.toFixed(2)}`,
      );
      report.memory.lastPositive = mem.recentPositiveInteraction;
      snapPersonality(kind, mem);
    }
    report.traces.push({ event: kind, memory: kind });
    patchSophie();
    maybePersist();
  },

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
    closeStateDuration(to);
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
    const now = Date.now();
    if (lastDecideAt > 0) {
      decideIntervalSum += now - lastDecideAt;
      decideIntervalCount += 1;
    }
    lastDecideAt = now;

    lastPick = pick;
    report.goalPicks.push({ pick, reason });
    bump(report.events, `pick:${pick}`);
    pickCount += 1;
    bump(distribution, pick);
    const fam = familyOf(pick);
    bump(families, fam);

    if (previous) bump(transitionCounts, `${previous}→${pick}`);

    pickHistory.push(pick);
    if (pickHistory.length > 64) pickHistory.shift();
    notePerceptualLoops();

    if (previous === "think" && (pick === "work" || pick === "study")) {
      bump(report.chains, `think→${pick}`);
    }
    if (previous === "look" && (pick === "window" || pick === "perch")) {
      bump(report.chains, `look→${pick}`);
    }
    if (previous === "work" && pick === "yawn") bump(report.chains, "work→yawn");
    if (previous === "yawn" && pick === "coffee") bump(report.chains, "yawn→coffee");
    if (previous === "yawn" && pick === "sleep") bump(report.chains, "yawn→sleep");

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
    maybePersist();
  },

  /** Wake soft (Phase 8) — observation only. */
  softWake(kind: string, whileBusy: boolean): void {
    softWakeCount += 1;
    if (whileBusy) softWakeWhileBusy += 1;
    bump(report.events, `softWake:${kind}`);
    if (flagEnabled()) {
      logLine(`softWake kind=${kind} busy=${whileBusy ? "1" : "0"}`);
    }
    patchSophie();
  },

  /** Re-score pendant busy qui a conservé l'activité (non utilisé Phase 8 Option 1). */
  noteBusyReevaluation(preserved: boolean): void {
    redecisionsWhileBusy += 1;
    if (preserved) busyPreserved += 1;
  },

  setGoal(label: string): void {
    lastGoalLabel = label;
    logLine(`goal=${label}`);
    report.traces.push({ goal: label, consideration: lastPick ?? undefined });
    patchSophie();
  },

  anim(state: string, clip: string, source: AnimSource): void {
    bump(report.animBySource, `${source}:${clip}`);
    animCount += 1;
    if (clip === "run") bump(report.cursor, "run");
    if (clip in report.emotions) bump(report.emotions, clip);

    if (lastGoalLabel === "perch" && (state === "HANG" || clip === "hang")) {
      bump(report.chains, "perch→hang");
    }
    if (state === "FALL" || clip === "fall") {
      if (lastState === "HANG") bump(report.chains, "hang→fall");
    }
    if (state === "SURPRISE" || clip === "surprise") {
      if (lastState === "FALL" || lastState === "IDLE") {
        bump(report.chains, "fall→surprise");
      }
    }
    if (state === "OVERWORK") bump(report.chains, "work→overwork");
    if (state === "YAWN" && lastState === "OVERWORK") {
      bump(report.chains, "overwork→yawn");
    }
    if (state === "IDLE" && lastState === "SLEEP") bump(report.chains, "sleep→idle");

    report.traces.push({
      state,
      clip,
      goal: lastGoalLabel ?? undefined,
      consideration: lastPick ?? undefined,
    });
    patchSophie();
  },

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

  exportSession(): SessionExport {
    const now = Date.now();
    const pendingDur = now - stateEnteredAt;
    let idleMs = longestIdleMs;
    let actMs = longestActivityMs;
    if (lastState === "IDLE" || lastState === null) {
      idleMs = Math.max(idleMs, pendingDur);
    } else if (lastState) {
      actMs = Math.max(actMs, pendingDur);
    }

    const topTransitions = Object.entries(transitionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, n]) => ({ key, n }));

    const emotionCount = Object.values(report.emotions).reduce((a, b) => a + b, 0);
    const observations: string[] = [];
    for (const [k, v] of Object.entries(perceptualLoops)) {
      if (v >= 3) observations.push(`loop ${k} ×${v}`);
    }
    if (pickCount > 20 && (distribution.idle ?? 0) / pickCount > 0.28) {
      observations.push("idle share élevée (>28%)");
    }
    if (actMs > 300_000) {
      observations.push(`longest activity ${(actMs / 60000).toFixed(1)} min`);
    }

    return {
      sessionStart,
      sessionDurationMs: now - sessionStart,
      pickCount,
      interactionCount,
      deferredInteractionCount,
      emotionCount,
      locomotionCount: families.locomotion ?? 0,
      focusCount: families.focus ?? 0,
      exploreCount: families.explore ?? 0,
      restCount: families.rest ?? 0,
      calmCount: families.calm ?? 0,
      socialCount: families.social ?? 0,
      animCount,
      distribution: { ...distribution },
      families: { ...families },
      emotions: { ...report.emotions },
      longestIdleMs: idleMs,
      longestActivityMs: actMs,
      softWakeCount,
      softWakeWhileBusy,
      busyPreserved,
      redecisionsWhileBusy,
      avgDecisionIntervalMs:
        decideIntervalCount > 0 ? decideIntervalSum / decideIntervalCount : 0,
      decisionIntervals: decideIntervalCount,
      topTransitions,
      perceptualLoops: { ...perceptualLoops },
      deferred: { ...report.deferred },
      personalitySnapshots: structuredClone(personalitySnapshots),
      interruptions: { ...report.interruptions },
      cursor: { ...report.cursor },
      chains: { ...report.chains },
      invalid: [...report.invalid],
      observations,
    };
  },

  formatRhythmReport(s: SessionExport = RuntimeAudit.exportSession()): string {
    const lines: string[] = [];
    lines.push("=== PHASE 8 RUNTIME RHYTHM ===");
    lines.push("");
    lines.push("Before (Phase 7):");
    lines.push("16.1 min");
    lines.push("8 Brain picks");
    lines.push("~14 min longest activity");
    lines.push("");
    lines.push("After:");
    lines.push(`${(s.sessionDurationMs / 60000).toFixed(1)} min`);
    lines.push(`${s.pickCount} Brain picks`);
    lines.push(
      `${(s.longestActivityMs / 1000).toFixed(1)}s longest activity` +
        (s.longestActivityMs > 60_000
          ? ` (${(s.longestActivityMs / 60000).toFixed(1)} min)`
          : ""),
    );
    lines.push(`${s.softWakeCount} soft wakes`);
    lines.push(`${s.softWakeWhileBusy} soft wakes while busy`);
    lines.push(`${s.busyPreserved} busy-preserved re-evaluations`);
    lines.push(`${s.redecisionsWhileBusy} redecisions while busy`);
    lines.push(
      `avg decision interval: ${
        s.avgDecisionIntervalMs > 0
          ? `${(s.avgDecisionIntervalMs / 1000).toFixed(1)}s`
          : "n/a"
      }`,
    );
    lines.push(`hang→idle: ${s.chains["hang→idle"] ?? 0}`);
    lines.push(`hang→fall: ${s.chains["hang→fall"] ?? 0}`);
    lines.push("");
    return lines.join("\n");
  },

  formatSessionReport(s: SessionExport = RuntimeAudit.exportSession()): string {
    const lines: string[] = [];
    const section = (title: string) => {
      lines.push("");
      lines.push(title);
      lines.push("-".repeat(Math.min(40, title.length)));
    };
    lines.push("=== RUNTIME PERSONALITY SESSION ===");
    lines.push("");
    lines.push(`Duration: ${(s.sessionDurationMs / 60000).toFixed(1)} min`);
    lines.push(`Picks: ${s.pickCount}`);
    lines.push(`Animations: ${s.animCount}`);
    lines.push(`Interactions: ${s.interactionCount}`);
    lines.push(`Deferred interactions: ${s.deferredInteractionCount}`);

    section("Distribution");
    const dist = Object.entries(s.distribution).sort((a, b) => b[1] - a[1]);
    for (const [id, n] of dist) {
      const p = s.pickCount ? ((100 * n) / s.pickCount).toFixed(1) : "0";
      lines.push(`${id}: ${n} (${p}%)`);
    }

    section("Families");
    for (const [f, n] of Object.entries(s.families).sort((a, b) => b[1] - a[1])) {
      lines.push(`${f}: ${n}`);
    }

    section("Emotions");
    for (const [e, n] of Object.entries(s.emotions)) lines.push(`${e}: ${n}`);

    section("Durations");
    lines.push(`Longest idle: ${(s.longestIdleMs / 1000).toFixed(1)}s`);
    lines.push(`Longest activity: ${(s.longestActivityMs / 1000).toFixed(1)}s`);
    lines.push(
      `Avg decision interval: ${
        s.avgDecisionIntervalMs > 0
          ? `${(s.avgDecisionIntervalMs / 1000).toFixed(1)}s`
          : "n/a"
      }`,
    );
    lines.push(`Soft wakes: ${s.softWakeCount} (busy: ${s.softWakeWhileBusy})`);
    lines.push(
      `Busy re-eval: ${s.redecisionsWhileBusy} (preserved: ${s.busyPreserved})`,
    );

    section("Top transitions");
    for (const t of s.topTransitions.slice(0, 15)) {
      lines.push(`${t.key}: ${t.n}`);
    }

    section("Potential perceptual loops");
    for (const [k, v] of Object.entries(s.perceptualLoops)) {
      lines.push(`${k}: ${v}`);
    }

    section("Deferred interactions");
    if (Object.keys(s.deferred).length === 0) lines.push("(none)");
    else for (const [k, v] of Object.entries(s.deferred)) lines.push(`${k}: ${v}`);

    section("Personality snapshots");
    if (s.personalitySnapshots.length === 0) lines.push("(none)");
    else {
      for (const p of s.personalitySnapshots.slice(-12)) {
        lines.push(
          `${p.tag}: playful=${p.playful.toFixed(2)} social=${p.social.toFixed(2)} ` +
            `curiosity=${p.curiosity.toFixed(2)} calm=${p.calm.toFixed(2)} ` +
            `independence=${p.independence.toFixed(2)}`,
        );
      }
    }

    section("Observations");
    if (s.observations.length === 0) lines.push("(aucune heuristique auto)");
    else for (const o of s.observations) lines.push(`• ${o}`);

    lines.push("");
    lines.push("=== END SESSION ===");
    return lines.join("\n");
  },

  /** Force persist + log résumé (appel manuel fin de session). */
  flushSession(): SessionExport {
    const s = RuntimeAudit.exportSession();
    maybePersist(true);
    if (flagEnabled()) {
      console.log(RuntimeAudit.formatSessionReport(s));
    }
    return s;
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
    "hang→idle",
    "fall→surprise",
    "sleep→idle",
    "work→overwork",
  ];
  if (watched.includes(key)) bump(report.chains, key);
  if (from === "WORK" && to === "OVERWORK") bump(report.chains, "work→overwork");
  if (from === "HANG" && to === "FALL") bump(report.chains, "hang→fall");
  if (from === "HANG" && to === "IDLE") bump(report.chains, "hang→idle");
  if (from === "FALL" && to === "SURPRISE") bump(report.chains, "fall→surprise");
  if (from === "YAWN" && to === "COFFEE") bump(report.chains, "yawn→coffee");
  if (from === "YAWN" && to === "SLEEP") bump(report.chains, "yawn→sleep");
  if (from === "WORK" && to === "YAWN") bump(report.chains, "work→yawn");
  if (from === "OVERWORK" && to === "YAWN") bump(report.chains, "overwork→yawn");
  if (from === "SLEEP" && to === "IDLE") bump(report.chains, "sleep→idle");
}
