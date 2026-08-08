/**
 * Rendu Canvas 2D.
 *
 * La fenêtre couvre tout l'écran mais le personnage n'en occupe qu'une fraction
 * minuscule. Effacer et redessiner la surface entière à chaque image coûterait
 * cher pour rien : on ne touche que le rectangle précédemment dessiné et le
 * nouveau. Sur macOS une fenêtre transparente est déjà recomposée par le
 * système à chaque image, inutile d'y ajouter du travail évitable.
 */

import type { DrawableFrame } from "../anim/AnimationPlayer";
import { drawFrame, frameRect, unionRect, type Rect, type RenderTarget } from "./SpriteDrawer";

/** Marge autour du sprite, pour absorber les arrondis du lissage. */
const DIRTY_PADDING = 2;

export class CanvasRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  #dpr = 1;
  #previousRect: Rect | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("contexte 2D indisponible");
    this.#context = context;
    this.resize();
  }

  resize(): void {
    this.#dpr = window.devicePixelRatio || 1;
    this.#canvas.width = Math.round(window.innerWidth * this.#dpr);
    this.#canvas.height = Math.round(window.innerHeight * this.#dpr);
    this.#previousRect = null;
  }

  /** Rectangle occupé par le personnage, en pixels logiques. */
  boundsOf(frames: readonly DrawableFrame[], target: RenderTarget): Rect | null {
    let rect: Rect | null = null;
    for (const frame of frames) {
      const current = frameRect(frame, target);
      rect = rect ? unionRect(rect, current) : current;
    }
    return rect;
  }

  draw(frames: readonly DrawableFrame[], target: RenderTarget): boolean {
    const rect = this.boundsOf(frames, target);
    const context = this.#context;

    context.save();
    context.scale(this.#dpr, this.#dpr);

    if (this.#previousRect) clearRect(context, this.#previousRect);
    if (rect) clearRect(context, rect);
    for (const frame of frames) drawFrame(context, frame, target);

    context.restore();
    this.#previousRect = rect;
    return true;
  }

  clear(): void {
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#previousRect = null;
  }
}

function clearRect(context: CanvasRenderingContext2D, rect: Rect): void {
  context.clearRect(
    Math.floor(rect.left) - DIRTY_PADDING,
    Math.floor(rect.top) - DIRTY_PADDING,
    Math.ceil(rect.width) + DIRTY_PADDING * 2,
    Math.ceil(rect.height) + DIRTY_PADDING * 2,
  );
}
