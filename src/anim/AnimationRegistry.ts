/**
 * Registre d'animations.
 *
 * Seul point du frontend qui connaisse le manifeste et le chargeur. Le reste du
 * moteur ne manipule que des identifiants logiques.
 */

import { AtlasLoader } from "../assets/AtlasLoader";
import type { AnimationId } from "../assets/generated/animations";
import type { AnimationEntry, Manifest } from "../assets/manifest";

/** Animations gardées en mémoire en permanence : ce sont les plus sollicitées. */
const PINNED: readonly AnimationId[] = ["idle", "walk"];

export interface Clip {
  readonly id: AnimationId;
  readonly fps: number;
  readonly loop: boolean;
  readonly frameCount: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly bitmaps: ImageBitmap[];
  /** Durée d'une lecture complète, en secondes. */
  readonly duration: number;
}

export class AnimationRegistry {
  readonly #entries: Record<AnimationId, AnimationEntry>;
  readonly #loader: AtlasLoader;
  readonly #clips = new Map<AnimationId, Clip>();

  constructor(manifest: Manifest) {
    this.#entries = manifest.animations;
    this.#loader = new AtlasLoader(manifest.animations, PINNED);
  }

  has(id: string): id is AnimationId {
    return id in this.#entries;
  }

  /** Clip prêt à jouer, ou `null` si les frames ne sont pas encore décodées. */
  get(id: AnimationId): Clip | null {
    const cached = this.#clips.get(id);
    if (cached && this.#loader.get(id)) return cached;

    const bitmaps = this.#loader.get(id);
    if (!bitmaps) return null;

    const clip = this.#buildClip(id, bitmaps);
    this.#clips.set(id, clip);
    return clip;
  }

  async load(id: AnimationId): Promise<Clip> {
    const bitmaps = await this.#loader.load(id);
    const clip = this.#buildClip(id, bitmaps);
    this.#clips.set(id, clip);
    return clip;
  }

  async preloadEssentials(): Promise<void> {
    await this.#loader.preload(PINNED);
  }

  #buildClip(id: AnimationId, bitmaps: ImageBitmap[]): Clip {
    const entry = this.#entries[id];
    return {
      id,
      fps: entry.fps,
      loop: entry.loop,
      frameCount: bitmaps.length,
      frameWidth: entry.frameWidth,
      frameHeight: entry.frameHeight,
      anchorX: entry.anchorX,
      anchorY: entry.anchorY,
      bitmaps,
      duration: bitmaps.length / entry.fps,
    };
  }
}
