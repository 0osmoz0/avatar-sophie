/**
 * Boucle à pas fixe.
 *
 * La simulation avance par pas de 1/60 s pour que la physique et les durées de
 * comportement soient reproductibles quelle que soit la cadence d'affichage. Le
 * rendu, lui, est plafonné et sauté quand rien n'a changé : sur macOS une
 * fenêtre transparente est recomposée à chaque image par le système, donc tout
 * dessin inutile se paie directement en batterie.
 */

const FIXED_STEP = 1 / 60;
/** Au-delà, on abandonne le retard plutôt que de rattraper en accéléré. */
const MAX_ACCUMULATED = 0.25;

export interface GameLoopOptions {
  update: (dt: number) => void;
  /** Doit renvoyer `true` si quelque chose a été dessiné. */
  render: () => boolean;
  /** Images par seconde maximales pour le rendu. */
  maxFps?: number;
}

export class GameLoop {
  readonly #update: (dt: number) => void;
  readonly #render: () => boolean;
  #minFrameInterval: number;

  #running = false;
  #rafId = 0;
  #lastTime = 0;
  #accumulator = 0;
  #lastRenderTime = 0;

  constructor({ update, render, maxFps = 30 }: GameLoopOptions) {
    this.#update = update;
    this.#render = render;
    this.#minFrameInterval = 1000 / maxFps;
  }

  set maxFps(fps: number) {
    this.#minFrameInterval = 1000 / fps;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    this.#lastRenderTime = 0;
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#rafId);
  }

  readonly #tick = (now: number): void => {
    if (!this.#running) return;
    this.#rafId = requestAnimationFrame(this.#tick);

    this.#accumulator = Math.min(
      this.#accumulator + (now - this.#lastTime) / 1000,
      MAX_ACCUMULATED,
    );
    this.#lastTime = now;

    while (this.#accumulator >= FIXED_STEP) {
      this.#update(FIXED_STEP);
      this.#accumulator -= FIXED_STEP;
    }

    if (now - this.#lastRenderTime < this.#minFrameInterval) return;
    if (this.#render()) this.#lastRenderTime = now;
  };
}
