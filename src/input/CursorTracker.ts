/**
 * Suivi du vrai curseur système côté frontend.
 *
 * Les positions physiques reçues du backend sont converties en coordonnées
 * locales à la fenêtre (zone utile), puis lissées pour éviter les à-coups.
 */

import type { WorkArea } from "../platform/tauri";

export class CursorTracker {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  #rawX = 0;
  #rawY = 0;
  #lastMoveAt = 0;
  #workArea: WorkArea;
  #scaleFactor: number;

  constructor(workArea: WorkArea) {
    this.#workArea = workArea;
    this.#scaleFactor = workArea.scaleFactor;
    this.x = workArea.width / 2;
    this.y = workArea.height / 2;
  }

  setWorkArea(workArea: WorkArea): void {
    this.#workArea = workArea;
    this.#scaleFactor = workArea.scaleFactor;
  }

  /** Met à jour depuis des pixels physiques bureau. */
  setPhysical(px: number, py: number, now = performance.now()): void {
    const localX = px / this.#scaleFactor - this.#workArea.x;
    const localY = py / this.#scaleFactor - this.#workArea.y;

    const dt = Math.max(0.001, (now - this.#lastMoveAt) / 1000);
    this.vx = (localX - this.#rawX) / dt;
    this.vy = (localY - this.#rawY) / dt;

    this.#rawX = localX;
    this.#rawY = localY;
    this.#lastMoveAt = now;
  }

  /** Lissage pour le rendu et la logique. */
  update(dt: number): void {
    const alpha = 1 - Math.exp(-18 * dt);
    this.x += (this.#rawX - this.x) * alpha;
    this.y += (this.#rawY - this.y) * alpha;

    // Décroissance de la vitesse perçue quand aucun événement n'arrive.
    this.vx *= Math.exp(-3 * dt);
    this.vy *= Math.exp(-3 * dt);
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vy) > 40;
  }

  get idleSeconds(): number {
    return (performance.now() - this.#lastMoveAt) / 1000;
  }

  distanceTo(x: number, y: number): number {
    return Math.hypot(this.x - x, this.y - y);
  }

  /** Accès debug / tests. */
  get lastSampleAge(): number {
    return this.idleSeconds;
  }
}
