/**
 * Géométrie et tracé d'une frame.
 *
 * Le manifeste donne un point d'ancrage placé sous les pieds du personnage.
 * Tout le moteur raisonne sur ce point : la position du corps est celle de ses
 * pieds au sol, jamais celle d'un coin d'image.
 */

import type { DrawableFrame } from "../anim/AnimationPlayer";

export interface RenderTarget {
  /** Position des pieds, en pixels logiques. */
  x: number;
  y: number;
  /** `1` regarde à droite, `-1` regarde à gauche. */
  facing: 1 | -1;
  scale: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function frameRect(frame: DrawableFrame, target: RenderTarget): Rect {
  const width = frame.bitmap.width * target.scale;
  const height = frame.bitmap.height * target.scale;
  const anchorX = frame.anchorX * target.scale;
  const anchorY = frame.anchorY * target.scale;

  return {
    left: target.x - (target.facing === 1 ? anchorX : width - anchorX),
    top: target.y - anchorY,
    width,
    height,
  };
}

export function drawFrame(
  context: CanvasRenderingContext2D,
  frame: DrawableFrame,
  target: RenderTarget,
): void {
  const width = frame.bitmap.width * target.scale;
  const height = frame.bitmap.height * target.scale;
  const anchorX = frame.anchorX * target.scale;
  const anchorY = frame.anchorY * target.scale;

  context.save();
  context.globalAlpha = frame.alpha;
  context.translate(target.x, target.y - anchorY);
  // Aucun sprite de profil n'existe dans les assets : la direction se joue au
  // miroir horizontal.
  if (target.facing === -1) context.scale(-1, 1);
  context.drawImage(frame.bitmap, -anchorX, 0, width, height);
  context.restore();
}

export function unionRect(a: Rect, b: Rect): Rect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}
