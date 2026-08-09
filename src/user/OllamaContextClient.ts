/**
 * Client Ollama local — classification de métadonnées uniquement.
 * Jamais de contenu d'écran. Ne choisit ni Goal ni animation.
 */

import type { InterpretedUserContext } from "./InterpretedUserContext";
import type { UserActivitySnapshot } from "./UserActivitySnapshot";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const DEFAULT_MODEL = "llama3.2";
const TIMEOUT_MS = 800;

function resolveModel(fallback: string): string {
  try {
    if (typeof window !== "undefined" && window.Sophie?.ollamaModel) {
      return window.Sophie.ollamaModel;
    }
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("sophieOllamaModel");
      if (stored) return stored;
    }
  } catch {
    /* ignore */
  }
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.SOPHIE_OLLAMA_MODEL;
    if (env) return env;
  } catch {
    /* ignore */
  }
  return fallback;
}

const MODES: readonly InterpretedUserContext["mode"][] = [
  "focused_work",
  "casual_browsing",
  "communication",
  "gaming",
  "media_watching",
  "idle_away",
  "switching_apps",
  "unknown",
] as const;

/** Résultat Ollama = sous-ensemble typé d'InterpretedUserContext (sans source/raw). */
export type OllamaClassification = Pick<
  InterpretedUserContext,
  | "mode"
  | "confidence"
  | "disturbanceTolerance"
  | "socialOpenness"
  | "autonomyBias"
  | "summary"
>;

function flagEnabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.Sophie?.useOllama) return true;
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("sophieUseOllama") === "1";
    }
  } catch {
    /* ignore */
  }
  return false;
}

function anonymizedPayload(snap: UserActivitySnapshot): Record<string, unknown> {
  return {
    category: snap.category,
    activeAppDurationSec: Math.round(snap.activeAppDurationSec),
    keyboardLevel: snap.keyboardLevel,
    pointerLevel: snap.pointerLevel,
    overallLevel: snap.overallLevel,
    secondsSinceLastInput: Math.round(snap.secondsSinceLastInput),
    lastAppChangeSec: Math.round(snap.lastAppChangeSec),
    appSwitchCountRecent: snap.appSwitchCountRecent,
    userBusy: snap.userBusy,
    userIdle: snap.userIdle,
    // Pas de nom d'app / titre / contenu.
  };
}

function parseClassification(text: string): OllamaClassification | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const mode = String(obj.mode ?? "unknown") as InterpretedUserContext["mode"];
    if (!MODES.includes(mode)) return null;
    const disturb = String(obj.disturbanceTolerance ?? "medium");
    if (disturb !== "low" && disturb !== "medium" && disturb !== "high") return null;
    const confidence = Number(obj.confidence);
    const socialOpenness = Number(obj.socialOpenness);
    const autonomyBias = Number(obj.autonomyBias);
    if (![confidence, socialOpenness, autonomyBias].every((n) => Number.isFinite(n))) {
      return null;
    }
    return {
      mode,
      confidence: Math.min(1, Math.max(0, confidence)),
      disturbanceTolerance: disturb,
      socialOpenness: Math.min(1, Math.max(0, socialOpenness)),
      autonomyBias: Math.min(1, Math.max(0, autonomyBias)),
      summary: String(obj.summary ?? mode).slice(0, 120),
    };
  } catch {
    return null;
  }
}

export class OllamaContextClient {
  readonly #model: string;

  constructor(model?: string) {
    this.#model = model ?? resolveModel(DEFAULT_MODEL);
  }

  static isEnabled(): boolean {
    return flagEnabled();
  }

  /**
   * Demande une classification JSON. Retourne null si indisponible / timeout / invalide.
   */
  async classify(snap: UserActivitySnapshot): Promise<OllamaClassification | null> {
    if (!flagEnabled()) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const signals = anonymizedPayload(snap);

    try {
      const res = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.#model,
          stream: false,
          format: "json",
          messages: [
            {
              role: "system",
              content:
                "You classify macOS usage metadata into a JSON object. " +
                "Never suggest animations or goals. Respond ONLY with JSON keys: " +
                "mode, confidence, disturbanceTolerance, socialOpenness, autonomyBias, summary. " +
                `mode one of: ${MODES.join(", ")}. ` +
                "disturbanceTolerance: low|medium|high. Numbers 0..1.",
            },
            {
              role: "user",
              content: JSON.stringify(signals),
            },
          ],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content ?? "";
      return parseClassification(content);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Exposé pour tests unitaires du parseur. */
export const __test = { parseClassification, anonymizedPayload };
