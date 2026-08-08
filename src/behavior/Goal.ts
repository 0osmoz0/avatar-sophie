import type { EdgeAnchor } from "../world/types";
import type { StateId } from "../state/types";
import type { BrainContext } from "./considerations/types";
import type { NeedsDeltas } from "./Needs";

/**
 * Intention comportementale.
 *
 * `then` est une suite optionnelle, pas une obligation : le Brain réévalue
 * `gate` au moment d'activer l'étape suivante et peut abandonner la chaîne.
 */
type GoalCommon = {
  label?: string;
  then?: Goal;
  /** Vérifié juste avant d'activer CE goal (contexte frais). Défaut = true. */
  gate?: (ctx: BrainContext) => boolean;
  /** Petits deltas Needs appliqués à la fin réussie de CE goal. */
  onComplete?: NeedsDeltas;
};

export type Goal =
  | (GoalCommon & {
      kind: "goTo";
      x: number;
      y?: number;
      /** Budget temps (s) calculé depuis la distance ; défaut géré par le Brain. */
      timeoutSec?: number;
      /** true → destination devenue invalide, abandonner la chaîne. */
      invalidate?: (ctx: BrainContext) => boolean;
    })
  | (GoalCommon & { kind: "activity"; state: StateId; duration?: number })
  | (GoalCommon & { kind: "perch"; anchor: EdgeAnchor; duration?: number })
  | (GoalCommon & { kind: "fall" })
  | (GoalCommon & { kind: "reactCursor"; mode: "notice" | "chase" })
  | (GoalCommon & { kind: "idle"; duration?: number });

export function goalLabel(goal: Goal): string {
  return goal.label ?? goal.kind;
}

/** Timeout goTo : distance / vitesse + marge, borné. */
export function goToTimeoutSec(distancePx: number, speedPxPerSec: number): number {
  const travel = distancePx / Math.max(1, speedPxPerSec);
  return Math.min(90, Math.max(12, travel + 10));
}
