import type { EdgeAnchor } from "../world/types";
import type { StateId } from "../state/types";

export type Goal =
  | { kind: "goTo"; x: number; y?: number; then?: Goal; label?: string }
  | { kind: "activity"; state: StateId; duration?: number; label?: string }
  | { kind: "perch"; anchor: EdgeAnchor; duration?: number; label?: string }
  | { kind: "fall"; label?: string }
  | { kind: "reactCursor"; mode: "notice" | "chase"; label?: string }
  | { kind: "idle"; duration?: number; label?: string };

export function goalLabel(goal: Goal): string {
  return goal.label ?? goal.kind;
}
