/**
 * Bornes utiles de l'écran.
 *
 * Les coordonnées manipulées par le moteur sont locales à la fenêtre, qui
 * couvre la zone utile de l'écran. Barre de menus, encoche et Dock en sont déjà
 * exclus côté Rust, mais il reste à réserver une marge pour que le personnage
 * ne soit pas coupé par les bords.
 */

import type { WorkArea } from "../platform/tauri";

/** Marge latérale minimale entre le personnage et le bord de l'écran. */
const EDGE_MARGIN = 24;

export class ScreenBounds {
  #workArea: WorkArea;
  #halfWidth = 0;

  constructor(workArea: WorkArea) {
    this.#workArea = workArea;
  }

  /** Demi-largeur du personnage, pour qu'il s'arrête avant de déborder. */
  set petHalfWidth(value: number) {
    this.#halfWidth = value;
  }

  update(workArea: WorkArea): void {
    this.#workArea = workArea;
  }

  get width(): number {
    return this.#workArea.width;
  }

  get height(): number {
    return this.#workArea.height;
  }

  /** Ordonnée du sol : le bas de la zone utile. */
  get floorY(): number {
    return this.#workArea.height;
  }

  get minX(): number {
    return EDGE_MARGIN + this.#halfWidth;
  }

  get maxX(): number {
    return this.#workArea.width - EDGE_MARGIN - this.#halfWidth;
  }

  clampX(x: number): number {
    return Math.min(this.maxX, Math.max(this.minX, x));
  }

  /** Vrai lorsque le personnage touche l'un des bords latéraux. */
  atEdge(x: number): boolean {
    return x <= this.minX + 1 || x >= this.maxX - 1;
  }

  /** Abscisse aléatoire à l'intérieur des bornes. */
  randomX(): number {
    return this.minX + Math.random() * Math.max(1, this.maxX - this.minX);
  }
}
