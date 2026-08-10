/**
 * Types du contrat d'intégration Sophie.
 * Aucune classe interne Brain / State / AnimationPlayer exposée.
 */

export type SophieInboundEventType =
  | "user_returned"
  | "user_idle"
  | "user_became_busy"
  | "user_became_focused"
  | "pet"
  | "poke"
  | "wave"
  | "love"
  | "app_opened"
  | "app_closed"
  | "media_started"
  | "media_stopped"
  | "music_started"
  | "music_stopped"
  | "external_activity";

export type SophieOutboundEventType =
  | "behavior_started"
  | "behavior_finished"
  | "user_interaction"
  | "state_changed";

export type SophieEventType = SophieInboundEventType | SophieOutboundEventType;

export interface SophieEventBase {
  type: SophieEventType;
  source?: string;
  timestamp?: number;
}

export interface SophieInboundEvent extends SophieEventBase {
  type: SophieInboundEventType;
  /** Catégorie média optionnelle (ex. music, video). */
  category?: string;
  /** Identifiant app / activité externe optionnel. */
  appId?: string;
  /** Charge libre minimale — jamais d'objets internes Brain. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface SophieOutboundEvent extends SophieEventBase {
  type: SophieOutboundEventType;
  behavior?: string;
  state?: string;
  interaction?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export type SophieEvent = SophieInboundEvent | SophieOutboundEvent;

export interface SophieSnapshot {
  readonly state: string;
  readonly activity: string | null;
  readonly userPresence: "active" | "idle" | "busy" | "unknown";
  readonly environment: {
    readonly nearEdge: boolean;
    readonly dangerousEdge: boolean;
    readonly nearWindow: boolean;
    readonly hanging: boolean;
    readonly focused: boolean;
    readonly musicPlaying: boolean | null;
  };
  readonly personality: {
    readonly playful: number;
    readonly social: number;
    readonly curiosity: number;
    readonly calm: number;
    readonly independence: number;
  };
}

export type SophieEventHandler<T extends SophieEvent = SophieEvent> = (
  event: T,
) => void;
