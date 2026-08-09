/**
 * Résolution contextuelle des interactions pointeur.
 * Pur / déterministe — Memory + Needs, jamais de random, jamais d'imposition forcée
 * pendant WORK/SLEEP/DANCE/COFFEE.
 */

import type { Memory } from "./Memory";
import type { Needs } from "./Needs";
import type { StateId } from "../state/types";

export type InteractionKind = "pet" | "poke" | "wave" | "love";

const BUSY_NO_INTERRUPT = new Set<StateId>([
  "WORK",
  "SLEEP",
  "DANCE",
  "COFFEE",
  "STUDY",
  "OVERWORK",
  "PHONE_CHECK",
  "PHONE_TEXT",
  "PHONE_CALL",
]);

/** Cooldowns anti-spam pour réactions émotionnelles immédiates. */
const REACTION_COOLDOWN_MS: Record<string, number> = {
  happy: 12_000,
  blow_kiss: 18_000,
  angry: 20_000,
  excited: 18_000,
  pet: 4_000,
  poke: 6_000,
  wave: 8_000,
  love: 10_000,
};

export interface ResolveInput {
  kind: InteractionKind;
  needs: Needs;
  memory: Memory;
  stateId: StateId;
  now: number;
}

export interface ResolveResult {
  /** Labels à mémoriser (toujours). */
  remember: Array<{ label: string; cooldownMs?: number }>;
  notePositive?: number;
  noteFrustration?: number;
  noteActivity?: number;
  /** État immédiat si autorisé ; null = différé / suppress. */
  immediateState: StateId | null;
  /** Raison de non-réaction immédiate (debug). */
  suppressReason?: string;
  deferred: boolean;
}

function isBusy(stateId: StateId): boolean {
  return BUSY_NO_INTERRUPT.has(stateId);
}

function canReact(memory: Memory, label: string, now: number): boolean {
  return memory.ready(label, now);
}

/**
 * Décide mémorisation + réaction éventuelle. N'applique rien — l'appelant
 * écrit dans Memory / StateMachine.
 */
export function resolveInteraction(input: ResolveInput): ResolveResult {
  const { kind, needs, memory, stateId, now } = input;
  const busy = isBusy(stateId);

  switch (kind) {
    case "pet":
      return resolvePet(needs, memory, now, busy);
    case "poke":
      return resolvePoke(needs, memory, now, busy);
    case "wave":
      return resolveWave(needs, memory, now, busy);
    case "love":
      return resolveLove(needs, memory, now, busy);
  }
}

function resolvePet(
  needs: Needs,
  memory: Memory,
  now: number,
  busy: boolean,
): ResolveResult {
  const base: ResolveResult = {
    remember: [{ label: "pet", cooldownMs: REACTION_COOLDOWN_MS.pet }],
    notePositive: 0.35,
    noteActivity: 0.15,
    immediateState: null,
    deferred: busy,
  };

  if (busy) {
    return { ...base, suppressReason: "busyState deferred" };
  }

  const petRecent = memory.recentWithin("pet", now, 25_000);
  if (
    needs.affection >= 70 &&
    needs.social >= 45 &&
    petRecent &&
    canReact(memory, "blow_kiss", now)
  ) {
    return {
      ...base,
      remember: [
        ...base.remember,
        { label: "blow_kiss", cooldownMs: REACTION_COOLDOWN_MS.blow_kiss },
      ],
      immediateState: "BLOW_KISS",
    };
  }

  if (needs.affection >= 50) {
    if (!canReact(memory, "happy", now) || memory.recentlyDid("happy", 2)) {
      return {
        ...base,
        immediateState: "PET",
        suppressReason: "recentlyUsed happy → pet only",
      };
    }
    return {
      ...base,
      remember: [
        ...base.remember,
        { label: "happy", cooldownMs: REACTION_COOLDOWN_MS.happy },
      ],
      immediateState: "HAPPY",
    };
  }

  return { ...base, immediateState: "PET" };
}

function resolvePoke(
  needs: Needs,
  memory: Memory,
  now: number,
  busy: boolean,
): ResolveResult {
  const base: ResolveResult = {
    remember: [{ label: "poke", cooldownMs: REACTION_COOLDOWN_MS.poke }],
    noteFrustration: 0.2,
    noteActivity: 0.1,
    immediateState: null,
    deferred: busy,
  };

  if (busy) {
    return { ...base, suppressReason: "busyState deferred" };
  }

  if (
    memory.recentWithin("poke", now, 8_000) ||
    memory.recentWithin("interrupted", now, 12_000)
  ) {
    return {
      ...base,
      noteFrustration: 0.1,
      suppressReason: "recentlyInterruptedOrPoked",
    };
  }

  if (needs.mood === "playful" && needs.energy >= 60 && canReact(memory, "excited", now)) {
    return {
      ...base,
      notePositive: 0.15,
      noteFrustration: 0.05,
      remember: [
        ...base.remember,
        { label: "excited", cooldownMs: REACTION_COOLDOWN_MS.excited },
      ],
      immediateState: "EXCITED",
    };
  }

  if (needs.affection < 35 && canReact(memory, "angry", now)) {
    return {
      ...base,
      noteFrustration: 0.4,
      remember: [
        ...base.remember,
        { label: "angry", cooldownMs: REACTION_COOLDOWN_MS.angry },
      ],
      immediateState: "ANGRY",
    };
  }

  return { ...base, immediateState: "POKE" };
}

function resolveWave(
  needs: Needs,
  memory: Memory,
  now: number,
  busy: boolean,
): ResolveResult {
  const base: ResolveResult = {
    remember: [{ label: "wave", cooldownMs: REACTION_COOLDOWN_MS.wave }],
    notePositive: 0.25,
    noteActivity: 0.12,
    immediateState: null,
    deferred: busy,
  };

  if (busy) {
    return { ...base, suppressReason: "busyState deferred" };
  }

  if (
    needs.affection >= 45 &&
    canReact(memory, "happy", now) &&
    !memory.recentlyDid("happy", 2)
  ) {
    return {
      ...base,
      remember: [
        ...base.remember,
        { label: "happy", cooldownMs: REACTION_COOLDOWN_MS.happy },
      ],
      immediateState: "HAPPY",
    };
  }

  return { ...base, immediateState: "WAVE" };
}

function resolveLove(
  needs: Needs,
  memory: Memory,
  now: number,
  busy: boolean,
): ResolveResult {
  const base: ResolveResult = {
    remember: [{ label: "love", cooldownMs: REACTION_COOLDOWN_MS.love }],
    notePositive: 0.4,
    noteActivity: 0.15,
    immediateState: null,
    deferred: busy,
  };

  if (busy) {
    return { ...base, suppressReason: "busyState deferred" };
  }

  if (
    needs.affection >= 70 &&
    needs.social >= 50 &&
    canReact(memory, "blow_kiss", now)
  ) {
    return {
      ...base,
      remember: [
        ...base.remember,
        { label: "blow_kiss", cooldownMs: REACTION_COOLDOWN_MS.blow_kiss },
      ],
      immediateState: "BLOW_KISS",
    };
  }

  if (canReact(memory, "happy", now) && !memory.recentlyDid("happy", 2)) {
    return {
      ...base,
      remember: [
        ...base.remember,
        { label: "happy", cooldownMs: REACTION_COOLDOWN_MS.happy },
      ],
      immediateState: "HAPPY",
    };
  }

  return { ...base, immediateState: "LOVE" };
}

export function isBusyState(stateId: StateId): boolean {
  return isBusy(stateId);
}
