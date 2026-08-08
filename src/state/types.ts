import type { AnimationId } from "../assets/generated/animations";
import type { Body } from "../motion/Body";
import type { MotionIntent } from "../motion/Locomotion";
import type { ScreenBounds } from "../motion/ScreenBounds";
import type { CursorTracker } from "../input/CursorTracker";
import type { Needs } from "../behavior/Needs";

export type StateId =
  | "IDLE"
  | "LOOK_AROUND"
  | "YAWN"
  | "WALK"
  | "RUN"
  | "FALL"
  | "HANG"
  | "SLEEP"
  | "COFFEE"
  | "WORK"
  | "OVERWORK"
  | "STUDY"
  | "EAT"
  | "THINK"
  | "DANCE"
  | "CURSOR_NOTICE"
  | "CURSOR_CHASE"
  | "DRAG"
  | "PET"
  | "POKE"
  | "WAVE"
  | "LOVE"
  | "BLOW_KISS"
  | "HAPPY"
  | "EXCITED"
  | "ANGRY"
  | "CRYING"
  | "SURPRISE"
  | "PUSH"
  | "PULL";

export interface StateContext {
  body: Body;
  bounds: ScreenBounds;
  cursor: CursorTracker;
  needs: Needs;
  /** Temps écoulé dans l'état courant, en secondes. */
  elapsed: number;
  now: number;
}

export interface StateResult {
  animation: AnimationId;
  /** Si vrai, le sélecteur peut remplacer l'animation selon la physique. */
  followsBody: boolean;
  motion: MotionIntent;
  /** Demande de transition, évaluée après `update`. */
  transition?: StateId;
}

export interface PetState {
  readonly id: StateId;
  readonly priority: number;
  enter(ctx: StateContext): void;
  update(ctx: StateContext, dt: number): StateResult;
  exit(ctx: StateContext): void;
  /** Refus d'interruption (ex. chute jusqu'à l'atterrissage). */
  canInterrupt?(by: StateId, priority: number): boolean;
}

export const PRIORITY: Record<StateId, number> = {
  IDLE: 0,
  LOOK_AROUND: 5,
  YAWN: 15,
  WALK: 10,
  RUN: 12,
  FALL: 90,
  HANG: 40,
  SLEEP: 20,
  COFFEE: 20,
  WORK: 20,
  OVERWORK: 25,
  STUDY: 20,
  EAT: 20,
  THINK: 18,
  DANCE: 22,
  CURSOR_NOTICE: 35,
  CURSOR_CHASE: 38,
  DRAG: 100,
  PET: 70,
  POKE: 70,
  WAVE: 50,
  LOVE: 50,
  BLOW_KISS: 50,
  HAPPY: 50,
  EXCITED: 50,
  ANGRY: 50,
  CRYING: 50,
  SURPRISE: 50,
  PUSH: 30,
  PULL: 30,
};
