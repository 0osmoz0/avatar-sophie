/**
 * Lecteur d'animation.
 *
 * Un seul clip actif à la fois, ce qui garantit qu'aucune animation ne se
 * superpose. Le fondu de sortie n'est pas cosmétique : les planches ayant été
 * générées indépendamment les unes des autres, elles ne se raccordent pas, et
 * une coupe franche entre deux poses très différentes se voit immédiatement.
 */

import type { AnimationId } from "../assets/generated/animations";
import type { AnimationRegistry, Clip } from "./AnimationRegistry";

const CROSSFADE_DURATION = 0.08;

export interface DrawableFrame {
  bitmap: ImageBitmap;
  anchorX: number;
  anchorY: number;
  alpha: number;
}

interface ActiveClip {
  clip: Clip;
  elapsed: number;
  frameIndex: number;
  finished: boolean;
}

export class AnimationPlayer {
  readonly #registry: AnimationRegistry;

  #current: ActiveClip | null = null;
  #outgoing: ActiveClip | null = null;
  #fadeRemaining = 0;
  /** Clip demandé dont les frames sont encore en cours de décodage. */
  #requested: AnimationId | null = null;
  #onFinished: (() => void) | null = null;
  #dirty = true;

  constructor(registry: AnimationRegistry) {
    this.#registry = registry;
  }

  get currentId(): AnimationId | null {
    return this.#current?.clip.id ?? null;
  }

  /** Vrai pour un clip non bouclé arrivé à sa dernière frame. */
  get finished(): boolean {
    return this.#current?.finished ?? false;
  }

  /** Vrai si l'image affichée a changé depuis le dernier rendu. */
  get dirty(): boolean {
    return this.#dirty;
  }

  clearDirty(): void {
    this.#dirty = false;
  }

  /**
   * Bascule sur un autre clip. Si ses frames ne sont pas encore décodées, le
   * clip courant continue de jouer et la bascule se fait dès qu'elles arrivent :
   * un chargement ne doit jamais provoquer de trou visuel.
   */
  play(id: AnimationId, options: { restart?: boolean; onFinished?: () => void } = {}): void {
    if (this.#current?.clip.id === id && !options.restart) {
      this.#onFinished = options.onFinished ?? null;
      return;
    }

    this.#onFinished = options.onFinished ?? null;
    this.#requested = id;

    const ready = this.#registry.get(id);
    if (ready) {
      this.#activate(ready);
      return;
    }

    void this.#registry.load(id).then((clip) => {
      if (this.#requested !== id) return;
      this.#activate(clip);
    });
  }

  update(dt: number): void {
    if (this.#fadeRemaining > 0) {
      this.#fadeRemaining = Math.max(0, this.#fadeRemaining - dt);
      if (this.#fadeRemaining === 0) this.#outgoing = null;
      this.#dirty = true;
    }

    if (this.#outgoing) this.#advance(this.#outgoing, dt);
    if (!this.#current) return;

    const previousFrame = this.#current.frameIndex;
    const wasFinished = this.#current.finished;
    this.#advance(this.#current, dt);

    if (this.#current.frameIndex !== previousFrame) this.#dirty = true;

    if (this.#current.finished && !wasFinished) {
      const callback = this.#onFinished;
      this.#onFinished = null;
      callback?.();
    }
  }

  /** Frames à dessiner, du fond vers le premier plan. */
  frames(): DrawableFrame[] {
    const result: DrawableFrame[] = [];
    const fade = this.#fadeRemaining / CROSSFADE_DURATION;

    if (this.#outgoing && fade > 0) result.push(toDrawable(this.#outgoing, fade));
    if (this.#current) result.push(toDrawable(this.#current, this.#outgoing ? 1 - fade : 1));

    return result;
  }

  #activate(clip: Clip): void {
    if (this.#current) {
      this.#outgoing = this.#current;
      this.#fadeRemaining = CROSSFADE_DURATION;
    }
    this.#current = { clip, elapsed: 0, frameIndex: 0, finished: false };
    this.#requested = null;
    this.#dirty = true;
  }

  #advance(active: ActiveClip, dt: number): void {
    if (active.finished) return;

    active.elapsed += dt;
    const rawIndex = Math.floor(active.elapsed * active.clip.fps);

    if (rawIndex < active.clip.frameCount) {
      active.frameIndex = rawIndex;
      return;
    }

    if (active.clip.loop) {
      active.frameIndex = rawIndex % active.clip.frameCount;
      // On ramène le compteur pour éviter toute perte de précision sur une
      // animation qui tourne pendant des heures.
      active.elapsed %= active.clip.duration;
    } else {
      active.frameIndex = active.clip.frameCount - 1;
      active.finished = true;
    }
  }
}

function toDrawable(active: ActiveClip, alpha: number): DrawableFrame {
  const { clip, frameIndex } = active;
  return {
    bitmap: clip.bitmaps[frameIndex] ?? clip.bitmaps[0]!,
    anchorX: clip.anchorX,
    anchorY: clip.anchorY,
    alpha,
  };
}
