/**
 * Traduction des intentions de mouvement en physique.
 *
 * Les états ne touchent jamais aux coordonnées : ils publient une intention,
 * qui est appliquée ici. C'est ce qui permet de changer d'animation sans
 * changer de trajectoire, et inversement.
 */

import type { Body } from "./Body";
import type { ScreenBounds } from "./ScreenBounds";

export const WALK_SPEED = 55;
export const RUN_SPEED = 230;

const ACCELERATION = 900;
const FRICTION = 1200;
const GRAVITY = 1800;
const MAX_FALL_SPEED = 1600;
/** En dessous, on considère la cible atteinte. */
const ARRIVAL_TOLERANCE = 4;

export type MotionIntent =
  /** Freine jusqu'à l'arrêt. */
  | { kind: "idle" }
  /** Rejoint une abscisse puis s'arrête. */
  | { kind: "moveTo"; x: number; speed: number }
  /** Suit une cible mobile en gardant une distance. */
  | { kind: "follow"; x: number; speed: number; stopDistance: number }
  /** Chute libre : aucun contrôle horizontal. */
  | { kind: "freefall" }
  /** Position imposée de l'extérieur, typiquement pendant un glisser. */
  | { kind: "held"; x: number; y: number };

export interface MotionResult {
  /** Vrai quand une intention `moveTo` a atteint sa cible. */
  arrived: boolean;
  /** Vrai quand le personnage vient de toucher le sol. */
  landed: boolean;
  /** Vrai quand le personnage bute contre un bord latéral. */
  blocked: boolean;
}

export class Locomotion {
  readonly #bounds: ScreenBounds;

  constructor(bounds: ScreenBounds) {
    this.#bounds = bounds;
  }

  apply(body: Body, intent: MotionIntent, dt: number): MotionResult {
    const wasAirborne = !body.grounded;
    let arrived = false;

    if (intent.kind === "held") {
      body.x = intent.x;
      body.y = intent.y;
      body.vx = 0;
      body.vy = 0;
      body.grounded = false;
      return { arrived: false, landed: false, blocked: false };
    }

    switch (intent.kind) {
      case "idle":
        this.#brake(body, dt);
        break;
      case "moveTo":
        arrived = this.#steer(body, intent.x, intent.speed, ARRIVAL_TOLERANCE, dt);
        break;
      case "follow":
        this.#steer(body, intent.x, intent.speed, intent.stopDistance, dt);
        break;
      case "freefall":
        break;
    }

    body.x += body.vx * dt;

    if (!body.grounded) {
      body.vy = Math.min(MAX_FALL_SPEED, body.vy + GRAVITY * dt);
      body.y += body.vy * dt;
    }

    const floor = this.#bounds.floorY;
    let landed = false;
    if (body.y >= floor) {
      body.y = floor;
      body.vy = 0;
      body.grounded = true;
      landed = wasAirborne;
    }

    const clamped = this.#bounds.clampX(body.x);
    const blocked = clamped !== body.x;
    if (blocked) {
      body.x = clamped;
      body.vx = 0;
    }

    return { arrived, landed, blocked };
  }

  #brake(body: Body, dt: number): void {
    const drop = FRICTION * dt;
    if (Math.abs(body.vx) <= drop) body.vx = 0;
    else body.vx -= Math.sign(body.vx) * drop;
  }

  /** @returns vrai si la cible est atteinte. */
  #steer(body: Body, targetX: number, speed: number, tolerance: number, dt: number): boolean {
    const delta = targetX - body.x;

    if (Math.abs(delta) <= tolerance) {
      this.#brake(body, dt);
      return true;
    }

    const desired = Math.sign(delta) * speed;
    const step = ACCELERATION * dt;
    body.vx = Math.abs(desired - body.vx) <= step ? desired : body.vx + Math.sign(desired - body.vx) * step;
    body.faceToward(targetX);
    return false;
  }
}
