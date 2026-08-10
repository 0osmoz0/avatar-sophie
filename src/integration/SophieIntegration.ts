/**
 * Adapter EventBus → Memory / context / soft wake.
 *
 * INTERDIT :
 * - requestState
 * - Goal forcé
 * - AnimationPlayer
 * - StateMachine.request
 *
 * Les événements externes deviennent uniquement des signaux.
 */

import type { BehaviorBrain } from "../behavior/BehaviorBrain";
import type { Memory } from "../behavior/Memory";
import type { Needs } from "../behavior/Needs";
import type { SophieEventBus } from "./SophieEventBus";
import type { SophieInboundEvent, SophieOutboundEvent } from "./types";

export interface SophieIntegrationDeps {
  bus: SophieEventBus;
  brain: BehaviorBrain;
  memory: Memory;
  needs: Needs;
  /** Lecture seule de l'état courant (jamais écrit ici). */
  getStateId: () => string;
  /** Lecture seule du dernier comportement. */
  getActivity?: () => string | null;
}

const INTERACTION = new Set(["pet", "poke", "wave", "love"]);

/**
 * Branche le bus public → signaux Memory + notifyUserActivity.
 * Retourne une fonction de détachement.
 */
export function attachSophieIntegration(deps: SophieIntegrationDeps): () => void {
  const { bus, brain, memory, needs } = deps;

  const onInbound = (raw: { type: string }): void => {
    const event = raw as SophieInboundEvent;
    if (!isInbound(event.type)) return;
    const now = event.timestamp ?? Date.now();

    switch (event.type) {
      case "user_returned":
        memory.remember("user_returned", now, 45_000);
        memory.notePositive(0.25);
        memory.noteActivity(0.15);
        brain.notifyUserActivity("user_returned");
        break;
      case "user_idle":
        memory.remember("user_became_idle", now, 60_000);
        memory.noteActivity(0.2);
        brain.notifyUserActivity("user_became_idle");
        break;
      case "user_became_busy":
        memory.remember("user_became_busy", now, 40_000);
        brain.notifyUserActivity("user_became_busy");
        break;
      case "user_became_focused":
        memory.remember("user_became_busy", now, 40_000);
        memory.nudgePersonality({ independence: 0.04 });
        brain.notifyUserActivity("user_became_focused");
        break;
      case "pet":
      case "poke":
      case "wave":
      case "love":
        // Memory only — jamais StateMachine.request ici.
        memory.remember(event.type, now, cooldownFor(event.type));
        if (event.type === "pet" || event.type === "love" || event.type === "wave") {
          memory.notePositive(0.3);
          needs.apply({ affection: event.type === "love" ? 6 : 3 });
        } else if (event.type === "poke") {
          memory.noteFrustration(0.25);
        }
        brain.notifyUserActivity(event.type);
        bus.emit({
          type: "user_interaction",
          interaction: event.type,
          source: "sophie-integration",
          timestamp: now,
        });
        break;
      case "app_opened":
      case "app_closed":
        memory.remember(event.type, now, 20_000);
        memory.noteActivity(0.1);
        brain.notifyUserActivity(event.type);
        break;
      case "media_started":
      case "media_stopped":
        memory.remember(event.type, now, 25_000);
        brain.notifyUserActivity(event.type);
        break;
      case "music_started":
        // Signal Memory uniquement — musicPlaying runtime reste null tant
        // qu'aucune source audio fiable n'existe (pas de fake).
        memory.remember("music_started", now, 30_000);
        brain.notifyUserActivity("music_started");
        break;
      case "music_stopped":
        memory.remember("music_stopped", now, 20_000);
        brain.notifyUserActivity("music_stopped");
        break;
      case "external_activity":
        memory.remember("external_activity", now, 15_000);
        memory.noteActivity(0.12);
        brain.notifyUserActivity("external_activity");
        break;
    }
  };

  const unsub = bus.subscribe("*", onInbound);

  // Miroir outbound high-level depuis events Brain (pas d'utilities).
  const unsubGoal = brain.events.on("goalFinished", (p) => {
    const out: SophieOutboundEvent = {
      type: "behavior_finished",
      behavior: p.label,
      source: "sophie-brain",
      timestamp: Date.now(),
    };
    bus.emit(out);
  });
  const unsubDecide = brain.events.on("decide", (p) => {
    const out: SophieOutboundEvent = {
      type: "behavior_started",
      behavior: p.pick,
      source: "sophie-brain",
      timestamp: Date.now(),
    };
    bus.emit(out);
  });

  return () => {
    unsub();
    unsubGoal();
    unsubDecide();
  };
}

function isInbound(type: string): boolean {
  return (
    type === "user_returned" ||
    type === "user_idle" ||
    type === "user_became_busy" ||
    type === "user_became_focused" ||
    INTERACTION.has(type) ||
    type === "app_opened" ||
    type === "app_closed" ||
    type === "media_started" ||
    type === "media_stopped" ||
    type === "music_started" ||
    type === "music_stopped" ||
    type === "external_activity"
  );
}

function cooldownFor(kind: string): number {
  switch (kind) {
    case "pet":
      return 4_000;
    case "poke":
      return 6_000;
    case "wave":
      return 8_000;
    case "love":
      return 10_000;
    default:
      return 5_000;
  }
}

/** Émet un state_changed outbound (appelé depuis main quand l'état change). */
export function emitStateChanged(
  bus: SophieEventBus,
  from: string | null,
  to: string,
): void {
  bus.emit({
    type: "state_changed",
    state: to,
    meta: { from: from ?? "" },
    source: "sophie-runtime",
    timestamp: Date.now(),
  });
}
