/**
 * Debug cerveau : logs structurés + overlay optionnel.
 *
 * Activer via `localStorage.sophieDebugBrain = "1"` ou `Sophie.debugBrain = true`.
 */

import type { UserActivitySnapshot } from "../user/UserActivitySnapshot";

export interface DecisionLog {
  pick: string;
  utility: number;
  reason: string;
  top: Array<{ id: string; u: number; reason?: string }>;
  needs: Record<string, number | string>;
  stateId: string;
  idleSeconds: number;
}

declare global {
  interface Window {
    Sophie?: {
      debugBrain?: boolean;
      lastDecision?: DecisionLog | null;
      lastUserActivity?: UserActivitySnapshot | null;
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
  overlayEl = el;
  return el;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.round(sec / 60)}m`;
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
    if (typeof window !== "undefined") {
      window.Sophie = {
        ...window.Sophie,
        lastUserActivity: snap,
        debugBrain: window.Sophie?.debugBrain,
      };
    }
    const line =
      `[UserActivity] app=${snap.activeApp ?? "none"} category=${snap.category} ` +
      `duration=${formatDuration(snap.activeAppDurationSec)} ` +
      `keyboard=${snap.keyboardLevel} pointer=${snap.pointerLevel} overall=${snap.overallLevel}`;
    if (line !== lastUserLine && flagEnabled()) {
      lastUserLine = line;
      console.log(line);
    }
  },

  decision(log: DecisionLog): void {
    if (typeof window !== "undefined") {
      window.Sophie = { ...window.Sophie, lastDecision: log, debugBrain: window.Sophie?.debugBrain };
    }
    if (!flagEnabled()) return;
    const top = log.top
      .slice(0, 3)
      .map((t) => `${t.id}=${t.u.toFixed(2)}`)
      .join(" ");
    const n = log.needs;
    console.log(
      `[Brain] pick=${log.pick} util=${log.utility.toFixed(2)} reason=${log.reason}\n` +
        `Needs e=${n.e} f=${n.f} b=${n.b} c=${n.c} s=${n.s} mood=${n.mood}\n` +
        `top: ${top} | state=${log.stateId} idle=${log.idleSeconds.toFixed(1)}s`,
    );
    const el = ensureOverlay();
    if (el) {
      el.textContent =
        `${lastUserLine.replace("[UserActivity] ", "")}\n` +
        `pick ${log.pick} (${log.utility.toFixed(2)})\n` +
        `${log.reason}\n` +
        `e${n.e} f${n.f} b${n.b} c${n.c} s${n.s} ${n.mood}`;
    }
  },

  status(line: string): void {
    if (!flagEnabled()) return;
    const el = ensureOverlay();
    if (el) {
      el.textContent = lastUserLine
        ? `${lastUserLine.replace("[UserActivity] ", "")}\n${line}`
        : line;
    }
  },
};
