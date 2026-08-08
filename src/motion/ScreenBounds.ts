/**
 * Bornes du desktop virtuel (overlay multi-écran).
 */

import type { WorldModel } from "../world/WorldModel";

const EDGE_MARGIN = 24;

export class ScreenBounds {
  #world: WorldModel;
  #halfWidth = 0;

  constructor(world: WorldModel) {
    this.#world = world;
  }

  set petHalfWidth(value: number) {
    this.#halfWidth = value;
  }

  get width(): number {
    return this.#world.width;
  }

  get height(): number {
    return this.#world.height;
  }

  get floorY(): number {
    return this.#world.height;
  }

  floorYAt(x: number): number {
    return this.#world.floorYAt(x);
  }

  get minX(): number {
    return EDGE_MARGIN + this.#halfWidth;
  }

  get maxX(): number {
    return this.#world.width - EDGE_MARGIN - this.#halfWidth;
  }

  clampX(x: number): number {
    return Math.min(this.maxX, Math.max(this.minX, x));
  }

  atEdge(x: number): boolean {
    return x <= this.minX + 1 || x >= this.maxX - 1;
  }

  randomX(): number {
    return this.minX + Math.random() * Math.max(1, this.maxX - this.minX);
  }
}
