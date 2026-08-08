/**
 * Modèle d'activité utilisateur — contexte uniquement, pas de décisions.
 *
 * Répond à : « Quel est le contexte actuel de l'utilisateur ? »
 */

import type { CursorTracker } from "../input/CursorTracker";
import {
  getUserActivity,
  onUserAppChanged,
  onUserSpaceChanged,
  type NativeUserActivity,
} from "../platform/tauri";
import { categorizeApp, isFocusCategory, type AppCategory } from "./AppCategories";
import {
  activityLevel,
  emptyUserActivitySnapshot,
  type RecentAppEntry,
  type UserActivitySnapshot,
} from "./UserActivitySnapshot";

const IDLE_USER_SEC = 240;
const BUSY_OVERALL = 0.55;
const POLL_MS = 1500;
const RECENT_WINDOW_MS = 10 * 60_000;
const MAX_RECENT = 6;

function idleToActivity(seconds: number, halfLifeSec: number): number {
  // 1 juste après un input, ~0 après plusieurs half-lives.
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.max(0, Math.min(1, Math.exp(-seconds / halfLifeSec)));
}

export type UserActivitySignal = "appChanged" | "spaceChanged" | "busyChanged" | "idleChanged";

export class UserActivityModel {
  #snapshot: UserActivitySnapshot = emptyUserActivitySnapshot();
  #appSince = performance.now();
  #lastAppKey = "";
  #lastAppChangeAt = 0;
  #lastSpaceChangeAt: number | null = null;
  #appSwitchTimes: number[] = [];
  #recent: RecentAppEntry[] = [];
  #lastPollAt = 0;
  #native: NativeUserActivity | null = null;
  #unsubs: Array<() => void> = [];
  #pendingSignals: UserActivitySignal[] = [];
  #wasBusy = false;
  #wasIdle = true;

  get snapshot(): UserActivitySnapshot {
    return this.#snapshot;
  }

  /** Drain les signaux soft (wake brain) sans forcer d'animation. */
  drainSignals(): UserActivitySignal[] {
    const out = this.#pendingSignals;
    this.#pendingSignals = [];
    return out;
  }

  async start(): Promise<void> {
    this.#unsubs.push(
      await onUserAppChanged((p) => {
        this.#noteApp(p.appName ?? null, p.bundleId ?? null, performance.now());
        this.#pendingSignals.push("appChanged");
      }),
    );
    this.#unsubs.push(
      await onUserSpaceChanged(() => {
        this.#lastSpaceChangeAt = performance.now();
        this.#pendingSignals.push("spaceChanged");
      }),
    );
    await this.#pollNative();
  }

  dispose(): void {
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
  }

  /**
   * Met à jour le snapshot. À appeler chaque frame / tick avec le curseur local.
   * Ne décide rien — fournit seulement le contexte.
   */
  update(now: number, cursor: CursorTracker): UserActivitySnapshot {
    if (now - this.#lastPollAt >= POLL_MS) {
      this.#lastPollAt = now;
      void this.#pollNative();
    }

    const native = this.#native;
    const appName = native?.appName ?? null;
    const bundleId = native?.bundleId ?? null;
    this.#trackAppDuration(appName, bundleId, now);

    const kbSys = idleToActivity(native?.secondsSinceKeyboard ?? 9999, 8);
    const mouseSys = idleToActivity(native?.secondsSinceMouse ?? 9999, 6);
    const pointerLocal = cursor.moving
      ? Math.min(1, Math.hypot(cursor.vx, cursor.vy) / 400)
      : idleToActivity(cursor.idleSeconds, 5);
    const pointerActivity = Math.max(mouseSys, pointerLocal * 0.85);
    const keyboardActivity = kbSys;
    const overallActivity = Math.max(
      keyboardActivity,
      pointerActivity,
      idleToActivity(native?.secondsSinceAny ?? cursor.idleSeconds, 10) * 0.9,
    );

    const secondsSinceLastInput = Math.min(
      native?.secondsSinceAny ?? 9999,
      cursor.idleSeconds,
    );

    const category = categorizeApp(bundleId, appName);
    const userBusy =
      overallActivity >= BUSY_OVERALL && isFocusCategory(category) && secondsSinceLastInput < 90;
    const userIdle = secondsSinceLastInput >= IDLE_USER_SEC;

    if (userBusy !== this.#wasBusy) {
      this.#wasBusy = userBusy;
      this.#pendingSignals.push("busyChanged");
    }
    if (userIdle !== this.#wasIdle) {
      this.#wasIdle = userIdle;
      this.#pendingSignals.push("idleChanged");
    }

    const lastAppChangeSec =
      this.#lastAppChangeAt > 0 ? (now - this.#lastAppChangeAt) / 1000 : 9999;
    const spaceChangeSec =
      this.#lastSpaceChangeAt == null ? null : (now - this.#lastSpaceChangeAt) / 1000;

    this.#appSwitchTimes = this.#appSwitchTimes.filter((t) => now - t <= RECENT_WINDOW_MS);

    this.#snapshot = {
      activeApp: appName,
      activeAppBundleId: bundleId,
      category,
      activeAppDurationSec: (now - this.#appSince) / 1000,
      keyboardActivity,
      pointerActivity,
      overallActivity,
      keyboardLevel: activityLevel(keyboardActivity),
      pointerLevel: activityLevel(pointerActivity),
      overallLevel: activityLevel(overallActivity),
      secondsSinceLastInput,
      lastAppChangeSec,
      appSwitchCountRecent: this.#appSwitchTimes.length,
      spaceChangeSec,
      recentApps: [...this.#recent],
      userBusy,
      userIdle,
      audioPlaying: null,
    };

    return this.#snapshot;
  }

  /** Injection tests / smoke. */
  replaceSnapshotForTest(snap: UserActivitySnapshot): void {
    this.#snapshot = snap;
  }

  async #pollNative(): Promise<void> {
    try {
      this.#native = await getUserActivity();
    } catch {
      this.#native = null;
    }
  }

  #trackAppDuration(name: string | null, bundleId: string | null, now: number): void {
    const key = `${bundleId ?? ""}|${name ?? ""}`;
    if (!key || key === "|") return;
    if (key === this.#lastAppKey) return;
    if (this.#lastAppKey) {
      const prev = this.#parseKey(this.#lastAppKey);
      const durationSec = (now - this.#appSince) / 1000;
      if (prev.name || prev.bundleId) {
        this.#pushRecent({
          name: prev.name ?? "unknown",
          bundleId: prev.bundleId,
          category: categorizeApp(prev.bundleId, prev.name),
          durationSec,
        });
      }
    }
    this.#noteApp(name, bundleId, now);
  }

  #noteApp(name: string | null, bundleId: string | null, now: number): void {
    const key = `${bundleId ?? ""}|${name ?? ""}`;
    if (key === this.#lastAppKey) return;
    this.#lastAppKey = key;
    this.#appSince = now;
    this.#lastAppChangeAt = now;
    this.#appSwitchTimes.push(now);
  }

  #parseKey(key: string): { name: string | null; bundleId: string | null } {
    const [bundleId, name] = key.split("|");
    return {
      bundleId: bundleId || null,
      name: name || null,
    };
  }

  #pushRecent(entry: RecentAppEntry): void {
    this.#recent.unshift(entry);
    if (this.#recent.length > MAX_RECENT) this.#recent.length = MAX_RECENT;
  }
}

/** Helpers de test pour fabriquer un snapshot. */
export function makeTestSnapshot(
  partial: Partial<UserActivitySnapshot> & { category?: AppCategory },
): UserActivitySnapshot {
  return {
    ...emptyUserActivitySnapshot(),
    ...partial,
    keyboardLevel: partial.keyboardLevel ?? activityLevel(partial.keyboardActivity ?? 0),
    pointerLevel: partial.pointerLevel ?? activityLevel(partial.pointerActivity ?? 0),
    overallLevel: partial.overallLevel ?? activityLevel(partial.overallActivity ?? 0),
  };
}
