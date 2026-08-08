import type { Goal } from "../Goal";
import type { Memory } from "../Memory";
import type { Needs, NeedsDeltas } from "../Needs";
import type { Body } from "../../motion/Body";
import type { CursorTracker } from "../../input/CursorTracker";
import type { WorldSnapshot } from "../../world/types";
import type { StateId } from "../../state/types";
import type { UserActivitySnapshot } from "../../user/UserActivitySnapshot";

export interface BrainContext {
  now: number;
  body: Body;
  cursor: CursorTracker;
  needs: Needs;
  memory: Memory;
  world: WorldSnapshot;
  userActivity: UserActivitySnapshot;
  stateId: StateId;
  idleSeconds: number;
  hour: number;
}

export interface Consideration {
  readonly id: string;
  /** Utilité brute ≥ 0. 0 = inéligible (précondition non remplie). */
  utility(ctx: BrainContext): number;
  buildGoal(ctx: BrainContext): Goal;
  /** Explication debug : « pourquoi maintenant ? » */
  reason?(ctx: BrainContext): string;
  /** Tie-break après utility (plus haut = préféré à score égal). */
  priority?: number;
  cooldownMs?: number;
  /** Deltas Needs appliqués à la fin du goal racine (en plus de Needs.update). */
  onComplete?: NeedsDeltas;
}
