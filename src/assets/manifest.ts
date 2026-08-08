/**
 * Manifeste d'animations.
 *
 * Il est produit par `tools/slice.mjs` : aucun chemin d'image n'est écrit à la
 * main dans le code. Ajouter une animation revient à ajouter une entrée dans
 * `tools/sheets.config.json` puis à relancer `npm run assets`.
 */

import type { AnimationId } from "./generated/animations";

export interface AnimationEntry {
  id: AnimationId;
  /** Dossier source dans asset/, conservé pour la traçabilité. */
  dir: string;
  fps: number;
  loop: boolean;
  frameWidth: number;
  frameHeight: number;
  /** Point d'ancrage dans la frame : les pieds du personnage. */
  anchorX: number;
  anchorY: number;
  frames: string[];
  droppedFrames: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  frameHeight: number;
  skinTint: boolean;
  animations: Record<AnimationId, AnimationEntry>;
}

export async function loadManifest(): Promise<Manifest> {
  const response = await fetch("/manifest.json");
  if (!response.ok) {
    throw new Error(
      "build/manifest.json est introuvable. Lance `npm run assets` pour générer les frames.",
    );
  }
  return (await response.json()) as Manifest;
}
