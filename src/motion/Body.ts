/**
 * État physique du personnage.
 *
 * Séparation stricte entre position et animation : rien ici ne sait quelle
 * image est affichée, et aucun état ne modifie ces valeurs directement. Les
 * états expriment une intention, la locomotion la traduit en vitesse, et le
 * corps ne fait que porter le résultat.
 */

export type Facing = 1 | -1;

export class Body {
  /** Position des pieds, en pixels logiques. */
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: Facing = 1;
  grounded = true;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  get speed(): number {
    return Math.abs(this.vx);
  }

  get moving(): boolean {
    return this.speed > 1;
  }

  /** Oriente le personnage vers une abscisse, sans à-coup si elle est proche. */
  faceToward(x: number, deadZone = 6): void {
    const delta = x - this.x;
    if (Math.abs(delta) < deadZone) return;
    this.facing = delta > 0 ? 1 : -1;
  }
}
