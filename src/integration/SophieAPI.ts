/**
 * Façade publique minimale pour intégration externe.
 *
 * SophieAPI.emit / subscribe / getSnapshot
 * Snapshot READ ONLY — jamais de mutation des systèmes internes.
 */

import type { BehaviorBrain } from "../behavior/BehaviorBrain";
import type { Needs } from "../behavior/Needs";
import type { Memory } from "../behavior/Memory";
import type { EnvironmentContext } from "../environment/EnvironmentContext";
import { SophieEventBus } from "./SophieEventBus";
import { attachSophieIntegration, emitStateChanged } from "./SophieIntegration";
import type {
  SophieEventHandler,
  SophieEventType,
  SophieInboundEvent,
  SophieSnapshot,
} from "./types";

export interface SophieAPIInit {
  brain: BehaviorBrain;
  needs: Needs;
  getStateId: () => string;
  getActivity?: () => string | null;
  getEnvironment?: () => EnvironmentContext | null;
  getUserPresence?: () => SophieSnapshot["userPresence"];
}

class SophieAPIImpl {
  readonly bus = new SophieEventBus();
  #detach: (() => void) | null = null;
  #init: SophieAPIInit | null = null;
  #memory: Memory | null = null;

  /**
   * Branche l'API sur une instance runtime Sophie.
   * Doit être appelé une fois depuis main.ts.
   */
  connect(init: SophieAPIInit): void {
    this.disconnect();
    this.#init = init;
    this.#memory = init.brain.memory;
    this.#detach = attachSophieIntegration({
      bus: this.bus,
      brain: init.brain,
      memory: init.brain.memory,
      needs: init.needs,
      getStateId: init.getStateId,
      getActivity: init.getActivity,
    });
  }

  disconnect(): void {
    this.#detach?.();
    this.#detach = null;
    this.#init = null;
    this.#memory = null;
    this.bus.clear();
  }

  emit(event: SophieInboundEvent): void {
    this.bus.emit(event);
  }

  subscribe(event: SophieEventType | "*", callback: SophieEventHandler): () => void {
    return this.bus.subscribe(event, callback);
  }

  /** Snapshot lecture seule — copies froides. */
  getSnapshot(): SophieSnapshot {
    const init = this.#init;
    const mem = this.#memory;
    const env = init?.getEnvironment?.() ?? null;
    const snap = mem?.personalitySnapshot() ?? {
      playful: 0.5,
      social: 0.5,
      curiosity: 0.5,
      calm: 0.5,
      independence: 0.5,
    };
    const out: SophieSnapshot = {
      state: init?.getStateId() ?? "UNKNOWN",
      activity: init?.getActivity?.() ?? mem?.lastBehavior() ?? null,
      userPresence: init?.getUserPresence?.() ?? "unknown",
      environment: {
        nearEdge: env?.nearEdge ?? false,
        dangerousEdge: env?.dangerousEdge ?? false,
        nearWindow: env?.nearWindow ?? false,
        hanging: env?.hanging ?? false,
        focused: env?.focused ?? false,
        musicPlaying: env?.musicPlaying ?? null,
      },
      personality: {
        playful: snap.playful,
        social: snap.social,
        curiosity: snap.curiosity,
        calm: snap.calm,
        independence: snap.independence,
      },
    };
    return Object.freeze({
      ...out,
      environment: Object.freeze({ ...out.environment }),
      personality: Object.freeze({ ...out.personality }),
    });
  }

  /** Helper runtime : publier un state_changed. */
  notifyStateChanged(from: string | null, to: string): void {
    emitStateChanged(this.bus, from, to);
  }
}

/** Singleton façade publique. */
export const SophieAPI = new SophieAPIImpl();
