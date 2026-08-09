/**
 * Interprète UserActivitySnapshot → InterpretedUserContext.
 * Règles toujours actives ; Ollama affine optionnellement (jamais de Goal).
 */

import type { UserActivitySignal } from "./UserActivityModel";
import {
  emptyInterpretedContext,
  type ContextMode,
  type InterpretedUserContext,
} from "./InterpretedUserContext";
import { OllamaContextClient } from "./OllamaContextClient";
import type { UserActivitySnapshot } from "./UserActivitySnapshot";

const OLLAMA_MIN_INTERVAL_MS = 45_000;

export function interpretRules(snap: UserActivitySnapshot): InterpretedUserContext {
  let mode: ContextMode = "unknown";
  let confidence = 0.55;
  let disturbanceTolerance: InterpretedUserContext["disturbanceTolerance"] = "medium";
  let socialOpenness = 0.4;
  let autonomyBias = 0.55;
  let summary = "neutral context";

  const longFocus =
    (snap.category === "coding" || snap.category === "productivity") &&
    snap.activeAppDurationSec >= 25 * 60;

  if (snap.userIdle) {
    mode = "idle_away";
    confidence = 0.75;
    disturbanceTolerance = "high";
    socialOpenness = 0.65;
    autonomyBias = 0.55;
    summary = "user idle — mild curiosity ok";
  } else if (snap.appSwitchCountRecent >= 5 && snap.lastAppChangeSec < 120) {
    mode = "switching_apps";
    confidence = 0.65;
    disturbanceTolerance = "medium";
    socialOpenness = 0.45;
    autonomyBias = 0.6;
    summary = "frequent app switching";
  } else if (
    (snap.category === "coding" || snap.category === "productivity") &&
    (snap.userBusy || longFocus)
  ) {
    mode = "focused_work";
    confidence = longFocus ? 0.88 : 0.78;
    disturbanceTolerance = "low";
    socialOpenness = 0.25;
    autonomyBias = 0.85;
    summary = "focused work — live quietly nearby";
  } else if (snap.category === "gaming" && snap.overallActivity >= 0.4) {
    mode = "gaming";
    confidence = 0.82;
    disturbanceTolerance = "low";
    socialOpenness = 0.2;
    autonomyBias = 0.88;
    summary = "gaming — avoid interrupting";
  } else if (snap.category === "communication" && (snap.userBusy || snap.overallActivity > 0.4)) {
    mode = "communication";
    confidence = 0.72;
    disturbanceTolerance = snap.userBusy ? "low" : "medium";
    socialOpenness = 0.35;
    autonomyBias = 0.7;
    summary = "in communication";
  } else if (snap.category === "media" && !snap.userIdle && snap.overallActivity >= 0.08) {
    mode = "media_watching";
    confidence = 0.7;
    disturbanceTolerance = "medium";
    socialOpenness = 0.4;
    autonomyBias = 0.75;
    summary = "watching media";
  } else if (snap.category === "browser") {
    mode = "casual_browsing";
    confidence = 0.68;
    disturbanceTolerance = "medium";
    socialOpenness = 0.45;
    autonomyBias = 0.6;
    summary = "casual browsing";
  } else if (snap.userBusy) {
    mode = "focused_work";
    confidence = 0.55;
    disturbanceTolerance = "low";
    socialOpenness = 0.3;
    autonomyBias = 0.8;
    summary = "user busy (generic)";
  }

  return {
    mode,
    confidence,
    disturbanceTolerance,
    socialOpenness,
    autonomyBias,
    source: "rules",
    summary,
    raw: snap,
  };
}

export class LocalContextInterpreter {
  readonly #ollama = new OllamaContextClient();
  #current: InterpretedUserContext = emptyInterpretedContext();
  #lastOllamaAt = 0;
  #ollamaInFlight = false;

  get current(): InterpretedUserContext {
    return this.#current;
  }

  /**
   * Sync : règles immédiates.
   * Async : Ollama sur signaux importants / intervalle, sans bloquer.
   */
  update(snap: UserActivitySnapshot, signals: UserActivitySignal[] = []): InterpretedUserContext {
    const rules = interpretRules(snap);
    // Garder enrichissement Ollama tant qu'il est plus confiant et récent.
    if (
      this.#current.source === "ollama" &&
      this.#current.raw.activeAppBundleId === snap.activeAppBundleId &&
      this.#current.mode === rules.mode &&
      this.#current.confidence >= rules.confidence
    ) {
      this.#current = {
        ...this.#current,
        raw: snap,
        // Recalcule soft des biais rules si Ollama n'a pas changé de mode
        autonomyBias: Math.max(this.#current.autonomyBias, rules.autonomyBias * 0.9),
      };
    } else {
      this.#current = rules;
    }

    const shouldAsk =
      OllamaContextClient.isEnabled() &&
      !this.#ollamaInFlight &&
      (signals.some((s) => s === "appChanged" || s === "busyChanged" || s === "idleChanged") ||
        performance.now() - this.#lastOllamaAt >= OLLAMA_MIN_INTERVAL_MS);

    if (shouldAsk) {
      this.#requestOllama(snap, rules);
    }

    return this.#current;
  }

  /** Injection tests. */
  replaceForTest(ctx: InterpretedUserContext): void {
    this.#current = ctx;
  }

  async #requestOllama(snap: UserActivitySnapshot, rules: InterpretedUserContext): Promise<void> {
    this.#ollamaInFlight = true;
    this.#lastOllamaAt = performance.now();
    try {
      const result = await this.#ollama.classify(snap);
      if (!result) return;
      if (!modesCompatible(rules.mode, result.mode)) return;
      // Merge soft : adopter seulement si plus confiant que les règles.
      if (result.confidence <= rules.confidence) return;
      this.#current = {
        mode: result.mode,
        confidence: result.confidence,
        disturbanceTolerance: result.disturbanceTolerance,
        socialOpenness: result.socialOpenness,
        autonomyBias: result.autonomyBias,
        source: "ollama",
        summary: result.summary,
        raw: snap,
      };
    } finally {
      this.#ollamaInFlight = false;
    }
  }
}

function modesCompatible(rules: ContextMode, ollama: ContextMode): boolean {
  if (rules === ollama) return true;
  if (rules === "unknown" || ollama === "unknown") return true;
  const workish = new Set<ContextMode>(["focused_work", "communication"]);
  const leisure = new Set<ContextMode>(["casual_browsing", "media_watching"]);
  if (workish.has(rules) && workish.has(ollama)) return true;
  if (leisure.has(rules) && leisure.has(ollama)) return true;
  return false;
}
