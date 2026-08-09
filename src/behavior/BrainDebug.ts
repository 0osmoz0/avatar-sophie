/**
 * Debug cerveau : logs structurés + overlay optionnel.
 *
 * Activer via `localStorage.sophieDebugBrain = "1"` ou `Sophie.debugBrain = true`.
 * Ollama : `localStorage.sophieUseOllama = "1"` ou `Sophie.useOllama = true`.
 */

import type { InterpretedUserContext } from "../user/InterpretedUserContext";
import { formatContextHint } from "../user/InterpretedUserContext";
import type { UserActivitySnapshot } from "../user/UserActivitySnapshot";
import type { Memory } from "./Memory";

export interface DecisionLog {
  pick: string;
  utility: number;
  reason: string;
  top: Array<{ id: string; u: number; reason?: string }>;
  needs: Record<string, number | string>;
  stateId: string;
  idleSeconds: number;
  context?: string;
  previous?: string | null;
  novelty?: string;
  noveltyValue?: number;
  chain?: string;
  personality?: string | null;
  personalitySnapshot?: {
    playful: number;
    social: number;
    curiosity: number;
    calm: number;
    independence: number;
  };
}

export type AnimSource = "brain" | "user" | "physics" | "chain" | "boot";

export interface AnimChangeLog {
  state: string;
  clip: string;
  source: AnimSource;
  at: number;
}

declare global {
  interface Window {
    Sophie?: {
      debugBrain?: boolean;
      debugRuntime?: boolean;
      useOllama?: boolean;
      ollamaModel?: string;
      lastDecision?: DecisionLog | null;
      lastUserActivity?: UserActivitySnapshot | null;
      lastContext?: InterpretedUserContext | null;
      /** Compteurs de clips réellement joués (changements uniquement). */
      animationCounts?: Record<string, number>;
      lastAnim?: AnimChangeLog | null;
      runtimeReport?: import("./RuntimeAudit").RuntimeReport | null;
      runtimeAudit?: typeof import("./RuntimeAudit").RuntimeAudit;
      lastSessionExport?: import("./RuntimeAudit").SessionExport | null;
    };
  }
}

function flagEnabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.Sophie?.debugBrain) return true;
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("sophieDebugBrain") === "1";
    }
  } catch {
    /* ignore */
  }
  return false;
}

let overlayEl: HTMLDivElement | null = null;
let lastUserLine = "";
let lastContextLine = "";
/** Compteurs locaux — exposés aussi sur `window.Sophie.animationCounts`. */
const animationCounts: Record<string, number> = {};
let lastAnimKey = "";

function ensureOverlay(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (overlayEl) return overlayEl;
  const el = document.createElement("div");
  el.id = "sophie-brain-debug";
  el.style.cssText = [
    "position:fixed",
    "left:8px",
    "bottom:8px",
    "z-index:99999",
    "pointer-events:none",
    "font:11px/1.35 ui-monospace,Menlo,monospace",
    "color:#e8f0e4",
    "background:rgba(12,18,14,0.72)",
    "padding:8px 10px",
    "border-radius:6px",
    "max-width:360px",
    "white-space:pre-wrap",
  ].join(";");
  document.body.appendChild(el);
  return (overlayEl = el);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.round(sec / 60)}m`;
}

function patchSophie(partial: Partial<NonNullable<Window["Sophie"]>>): void {
  if (typeof window === "undefined") return;
  window.Sophie = { ...window.Sophie, ...partial };
}

export const BrainDebug = {
  enabled(): boolean {
    return flagEnabled();
  },

  log(message: string, extra?: unknown): void {
    if (!flagEnabled()) return;
    if (extra !== undefined) console.log(`[Brain] ${message}`, extra);
    else console.log(`[Brain] ${message}`);
  },

  userActivity(snap: UserActivitySnapshot): void {
    patchSophie({ lastUserActivity: snap });
    const line =
      `[UserActivity] app=${snap.activeApp ?? "none"} category=${snap.category} ` +
      `duration=${formatDuration(snap.activeAppDurationSec)} ` +
      `keyboard=${snap.keyboardLevel} pointer=${snap.pointerLevel} overall=${snap.overallLevel}`;
    if (line !== lastUserLine && flagEnabled()) {
      lastUserLine = line;
      console.log(line);
    }
  },

  context(ctx: InterpretedUserContext): void {
    patchSophie({ lastContext: ctx });
    const line =
      `[Context] mode=${ctx.mode} conf=${ctx.confidence.toFixed(2)} source=${ctx.source} ` +
      `disturb=${ctx.disturbanceTolerance} autonomy=${ctx.autonomyBias.toFixed(2)} ` +
      `social=${ctx.socialOpenness.toFixed(2)} — ${ctx.summary}`;
    if (line !== lastContextLine && flagEnabled()) {
      lastContextLine = line;
      console.log(line);
    }
  },

  decision(log: DecisionLog, mem?: Memory, now?: number): void {
    patchSophie({ lastDecision: log });
    if (!flagEnabled()) return;
    const top = log.top
      .slice(0, 3)
      .map((t) => `${t.id}=${t.u.toFixed(2)}`)
      .join(" ");
    const n = log.needs;
    const ctxBit = log.context ? ` context=${log.context}` : "";
    const prevBit =
      log.previous != null && log.previous !== ""
        ? ` previous=${log.previous}`
        : log.previous === null
          ? " previous=none"
          : "";
    const novBit = log.novelty ? ` novelty=${log.novelty}` : "";
    const chainBit = log.chain ? ` chain=${log.chain}` : "";
    const persBit = log.personality ? ` personality=${log.personality}` : "";
    const chainBoostHint = /chainBoost=/.test(log.reason)
      ? ` reason=${log.reason.match(/chainBoost=[^\s]+/)?.[0] ?? log.reason}`
      : ` reason=${log.reason}`;
    if (log.personalitySnapshot) {
      const p = log.personalitySnapshot;
      console.log(
        `[Personality]\nplayful=${p.playful.toFixed(2)} social=${p.social.toFixed(2)} ` +
          `curiosity=${p.curiosity.toFixed(2)}\n` +
          `calm=${p.calm.toFixed(2)} independence=${p.independence.toFixed(2)}`,
      );
    }
    console.log(
      `[Brain] pick=${log.pick}${chainBoostHint}${prevBit}${novBit}${chainBit}${persBit}${ctxBit}\n` +
        `util=${log.utility.toFixed(2)} Needs e=${n.e} f=${n.f} b=${n.b} c=${n.c} s=${n.s} mood=${n.mood}\n` +
        `top: ${top} | state=${log.stateId} idle=${log.idleSeconds.toFixed(1)}s`,
    );
    if (mem && now != null) {
      BrainDebug.memory(mem, now);
    }
    const el = ensureOverlay();
    if (el) {
      const memLine =
        mem && now != null
          ? `pos=${mem.recentPositiveInteraction.toFixed(2)} fr=${mem.recentFrustration.toFixed(2)}`
          : "";
      const persLine = log.personalitySnapshot
        ? `p=${log.personalitySnapshot.playful.toFixed(2)} s=${log.personalitySnapshot.social.toFixed(2)} ` +
          `c=${log.personalitySnapshot.curiosity.toFixed(2)} i=${log.personalitySnapshot.independence.toFixed(2)}`
        : "";
      el.textContent =
        `${lastContextLine || lastUserLine}\n` +
        `pick ${log.pick} (${log.utility.toFixed(2)})${prevBit}${novBit}${chainBit}${persBit}\n` +
        `${log.reason}\n` +
        `e${n.e} f${n.f} b${n.b} c${n.c} s${n.s} ${n.mood}` +
        (memLine ? `\n${memLine}` : "") +
        (persLine ? `\n${persLine}` : "");
    }
  },

  status(line: string): void {
    if (!flagEnabled()) return;
    const el = ensureOverlay();
    if (el) {
      const head = lastContextLine || lastUserLine.replace("[UserActivity] ", "");
      el.textContent = head ? `${head}\n${line}` : line;
    }
  },

  suppress(
    id: string,
    reason: string,
    opts?: { ageSec?: number; novelty?: number },
  ): void {
    if (!flagEnabled()) return;
    const ageBit =
      opts?.ageSec != null ? ` age=${opts.ageSec.toFixed(1)}s` : "";
    const novBit =
      opts?.novelty != null ? ` novelty=${opts.novelty.toFixed(2)}` : "";
    console.log(`[Brain] suppress=${id} reason=${reason}${ageBit}${novBit}`);
  },

  memory(mem: Memory, now: number): void {
    if (!flagEnabled()) return;
    const entries = mem.recentEntries(now, 4);
    const lines = entries.map((e) => `recent=${e.label} age=${e.ageSec.toFixed(1)}s`);
    console.log(
      `[Memory]\n${lines.join("\n") || "(empty)"}\n` +
        `recentPositive=${mem.recentPositiveInteraction.toFixed(2)} ` +
        `recentFrustration=${mem.recentFrustration.toFixed(2)} ` +
        `recentActivity=${mem.recentActivity.toFixed(2)}`,
    );
  },

  formatContextShort(ctx: InterpretedUserContext): string {
    return `${ctx.mode}/${ctx.disturbanceTolerance}`;
  },

  formatContextHint,

  /**
   * Trace un changement de clip réellement joué (pas chaque frame).
   * Actif uniquement si le debug Brain est activé (logs) ; les compteurs
   * sont toujours mis à jour pour lecture via `Sophie.animationCounts`.
   */
  anim(state: string, clip: string, source: AnimSource = "brain"): void {
    const key = `${state}|${clip}|${source}`;
    if (key === lastAnimKey) return;
    lastAnimKey = key;

    animationCounts[clip] = (animationCounts[clip] ?? 0) + 1;
    const entry: AnimChangeLog = { state, clip, source, at: Date.now() };
    patchSophie({ animationCounts: { ...animationCounts }, lastAnim: entry });

    if (!flagEnabled()) return;
    console.log(`[Anim] state=${state} clip=${clip} source=${source}`);
  },

  animationCounts(): Record<string, number> {
    return { ...animationCounts };
  },

  resetAnimationCounts(): void {
    for (const k of Object.keys(animationCounts)) delete animationCounts[k];
    lastAnimKey = "";
    patchSophie({ animationCounts: {}, lastAnim: null });
  },
};
