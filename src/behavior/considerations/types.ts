import type { Goal } from "../Goal";
import type { Memory } from "../Memory";
import type { Needs } from "../Needs";
import type { Body } from "../../motion/Body";
import type { CursorTracker } from "../../input/CursorTracker";
import type { WorldSnapshot } from "../../world/types";
import type { StateId } from "../../state/types";

export interface BrainContext {
  now: number;
  body: Body;
  cursor: CursorTracker;
  needs: Needs;
  memory: Memory;
  world: WorldSnapshot;
  stateId: StateId;
  idleSeconds: number;
  hour: number;
}

export interface Consideration {
  readonly id: string;
  /** Utilité brute ≥ 0. 0 = inéligible. */
  utility(ctx: BrainContext): number;
  buildGoal(ctx: BrainContext): Goal;
  cooldownMs?: number;
}
