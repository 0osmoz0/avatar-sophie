/**
 * Hit-test alpha sur la frame courante.
 *
 * Seuls les pixels vraiment opaques du personnage capturent les clics ; le reste
 * de l'overlay laisse passer les événements vers le bureau.
 */

import type { DrawableFrame } from "../anim/AnimationPlayer";
import { frameRect, type RenderTarget } from "../render/SpriteDrawer";

const OFFSCREEN = document.createElement("canvas");
const OFF_CTX = OFFSCREEN.getContext("2d", { willReadFrequently: true })!;

export function hitTestSprite(
  frames: readonly DrawableFrame[],
  target: RenderTarget,
  clientX: number,
  clientY: number,
  alphaThreshold = 24,
): boolean {
  // On teste la frame la plus opaque (premier plan).
  const frame = frames[frames.length - 1];
  if (!frame) return false;

  const rect = frameRect(frame, target);
  if (
    clientX < rect.left ||
    clientY < rect.top ||
    clientX >= rect.left + rect.width ||
    clientY >= rect.top + rect.height
  ) {
    return false;
  }

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  // Remap dans l'espace bitmap, en tenant compte du miroir.
  let sampleX = (localX / rect.width) * frame.bitmap.width;
  const sampleY = (localY / rect.height) * frame.bitmap.height;
  if (target.facing === -1) sampleX = frame.bitmap.width - sampleX;

  const sx = Math.floor(sampleX);
  const sy = Math.floor(sampleY);
  if (sx < 0 || sy < 0 || sx >= frame.bitmap.width || sy >= frame.bitmap.height) {
    return false;
  }

  OFFSCREEN.width = 1;
  OFFSCREEN.height = 1;
  OFF_CTX.clearRect(0, 0, 1, 1);
  OFF_CTX.drawImage(frame.bitmap, sx, sy, 1, 1, 0, 0, 1, 1);
  const pixel = OFF_CTX.getImageData(0, 0, 1, 1).data;
  return (pixel[3] ?? 0) >= alphaThreshold;
}
