import type { Goal } from "../Goal";
import type { Memory } from "../Memory";
import type { Needs, NeedsDeltas } from "../Needs";
import type { Body } from "../../motion/Body";
import type { CursorTracker } from "../../input/CursorTracker";
import type { WorldSnapshot } from "../../world/types";
import type { StateId } from "../../state/types";
import type { InterpretedUserContext } from "../../user/InterpretedUserContext";
import type { UserActivitySnapshot } from "../../user/UserActivitySnapshot";
import type { EnvironmentContext } from "../../environment/EnvironmentContext";

export interface BrainContext {
  now: number;
  body: Body;
  cursor: CursorTracker;
  needs: Needs;
  memory: Memory;
  world: WorldSnapshot;
  userActivity: UserActivitySnapshot;
  /** Contexte interprété (règles ± Ollama) — modifiers only. */
  interpretedContext: InterpretedUserContext;
  /** Conscience spatiale — lecture seule, jamais de Goal forcé. */
  environment: EnvironmentContext;
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
