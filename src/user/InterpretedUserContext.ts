import {
  emptyUserActivitySnapshot,
  type UserActivitySnapshot,
} from "./UserActivitySnapshot";

/**
 * Contexte utilisateur interprété — modifiers uniquement.
 * Jamais de suggestedGoal / suggestedAnimation.
 */
export type ContextMode =
  | "focused_work"
  | "casual_browsing"
  | "communication"
  | "gaming"
  | "media_watching"
  | "idle_away"
  | "switching_apps"
  | "unknown";

export type DisturbanceTolerance = "low" | "medium" | "high";

export interface InterpretedUserContext {
  mode: ContextMode;
  confidence: number;
  /** low = éviter de déranger l'utilisateur. */
  disturbanceTolerance: DisturbanceTolerance;
  /** Idle → un peu plus ouvert socialement (sans forcer chase). */
  socialOpenness: number;
  /** Encourager la vie autonome à côté de l'utilisateur. */
  autonomyBias: number;
  source: "rules" | "ollama";
  summary: string;
  raw: UserActivitySnapshot;
}

export function emptyInterpretedContext(
  raw: UserActivitySnapshot = emptyUserActivitySnapshot(),
): InterpretedUserContext {
  return {
    mode: "unknown",
    confidence: 0.3,
    disturbanceTolerance: "medium",
    socialOpenness: 0.4,
    autonomyBias: 0.5,
    source: "rules",
    summary: "unknown context",
    raw,
  };
}

export function formatContextHint(ctx: InterpretedUserContext): string {
  return `context=${ctx.mode}/${ctx.disturbanceTolerance} conf=${ctx.confidence.toFixed(2)} src=${ctx.source}`;
}

export function makeTestInterpreted(
  partial: Partial<InterpretedUserContext> & { raw: UserActivitySnapshot },
): InterpretedUserContext {
  return {
    ...emptyInterpretedContext(partial.raw),
    ...partial,
  };
}
