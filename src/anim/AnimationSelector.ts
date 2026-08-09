/**
 * Choix du clip à jouer.
 *
 * Un état demande une animation logique ; c'est ici que l'état physique du
 * corps peut la remplacer. Un état qui veut marcher n'a pas à savoir s'il faut
 * jouer `walk` ou `run` : il demande le déplacement, le sélecteur regarde la
 * vitesse réelle.
 *
 * Note : `run` est un clip de locomotion pure (pas d'état RunState dans la
 * StateMachine). Il apparaît surtout pendant CURSOR_CHASE / followBody rapide.
 */

import type { AnimationId } from "../assets/generated/animations";
import type { Body } from "../motion/Body";
import { RUN_SPEED } from "../motion/Locomotion";

/** Au-delà de cette fraction de la vitesse de course, on passe à `run`. */
const RUN_THRESHOLD = RUN_SPEED * 0.55;
const MOVE_THRESHOLD = 6;

export interface SelectionRequest {
  /** Animation demandée par l'état courant. */
  requested: AnimationId;
  /**
   * Vrai si l'état laisse le corps décider. Un état d'activité comme `work`
   * garde son animation même si le personnage glisse encore un peu.
   */
  followsBody: boolean;
}

export function selectAnimation(request: SelectionRequest, body: Body): AnimationId {
  if (!request.followsBody) return request.requested;

  if (!body.grounded) return "fall";
  if (body.speed >= RUN_THRESHOLD) return "run";
  if (body.speed >= MOVE_THRESHOLD) return "walk";
  return request.requested;
}
