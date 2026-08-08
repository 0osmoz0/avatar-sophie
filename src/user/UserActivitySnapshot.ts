import type { AppCategory } from "./AppCategories";

export type ActivityLevel = "idle" | "low" | "medium" | "high";

export interface RecentAppEntry {
  name: string;
  bundleId: string | null;
  category: AppCategory;
  durationSec: number;
}

/**
 * Snapshot immutable du contexte d'utilisation Mac.
 * Aucun contenu d'écran / texte — métadonnées d'activité uniquement.
 */
export interface UserActivitySnapshot {
  activeApp: string | null;
  activeAppBundleId: string | null;
  category: AppCategory;
  activeAppDurationSec: number;
  keyboardActivity: number;
  pointerActivity: number;
  overallActivity: number;
  keyboardLevel: ActivityLevel;
  pointerLevel: ActivityLevel;
  overallLevel: ActivityLevel;
  secondsSinceLastInput: number;
  /** Âge du dernier changement d'app (secondes). */
  lastAppChangeSec: number;
  appSwitchCountRecent: number;
  /** Âge du dernier Space change ; null si jamais reçu. */
  spaceChangeSec: number | null;
  recentApps: readonly RecentAppEntry[];
  /** Occupé sur une app focus + activité haute. */
  userBusy: boolean;
  /** Aucun input depuis plusieurs minutes. */
  userIdle: boolean;
  /** Placeholder v1 — audio non branché. */
  audioPlaying: null;
}

export function activityLevel(value01: number): ActivityLevel {
  if (value01 < 0.08) return "idle";
  if (value01 < 0.35) return "low";
  if (value01 < 0.65) return "medium";
  return "high";
}

export function emptyUserActivitySnapshot(): UserActivitySnapshot {
  return {
    activeApp: null,
    activeAppBundleId: null,
    category: "unknown",
    activeAppDurationSec: 0,
    keyboardActivity: 0,
    pointerActivity: 0,
    overallActivity: 0,
    keyboardLevel: "idle",
    pointerLevel: "idle",
    overallLevel: "idle",
    secondsSinceLastInput: 9999,
    lastAppChangeSec: 9999,
    appSwitchCountRecent: 0,
    spaceChangeSec: null,
    recentApps: [],
    userBusy: false,
    userIdle: true,
    audioPlaying: null,
  };
}

/** Résumé court pour reason() / logs. */
export function formatUserActivityHint(snap: UserActivitySnapshot): string {
  const busy = snap.userBusy ? " userBusy=true" : snap.userIdle ? " userIdle=true" : "";
  return `userActivity=${snap.category}/${snap.overallLevel}${busy}`;
}
