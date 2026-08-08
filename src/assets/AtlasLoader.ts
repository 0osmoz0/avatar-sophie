/**
 * Chargement des frames.
 *
 * Les 1200 frames décodées représenteraient plusieurs centaines de mégaoctets :
 * elles sont donc chargées animation par animation, à la demande, avec un cache
 * à éviction par ancienneté. Les animations épinglées, celles qui reviennent en
 * permanence, échappent à l'éviction.
 */

import type { AnimationId } from "./generated/animations";
import type { AnimationEntry } from "./manifest";

/** Au-delà, la mémoire grimpe plus vite que le confort visuel. */
const DEFAULT_MAX_RESIDENT = 6;

export class AtlasLoader {
  readonly #entries: Record<AnimationId, AnimationEntry>;
  readonly #pinned: ReadonlySet<AnimationId>;
  readonly #maxResident: number;

  readonly #loaded = new Map<AnimationId, ImageBitmap[]>();
  readonly #pending = new Map<AnimationId, Promise<ImageBitmap[]>>();
  /** Ordre d'utilisation, du plus ancien au plus récent. */
  readonly #usage: AnimationId[] = [];

  constructor(
    entries: Record<AnimationId, AnimationEntry>,
    pinned: readonly AnimationId[] = [],
    maxResident = DEFAULT_MAX_RESIDENT,
  ) {
    this.#entries = entries;
    this.#pinned = new Set(pinned);
    this.#maxResident = maxResident;
  }

  /** Frames déjà en mémoire, ou `null` s'il faut encore les charger. */
  get(id: AnimationId): ImageBitmap[] | null {
    const frames = this.#loaded.get(id);
    if (frames) this.#touch(id);
    return frames ?? null;
  }

  async load(id: AnimationId): Promise<ImageBitmap[]> {
    const existing = this.#loaded.get(id);
    if (existing) {
      this.#touch(id);
      return existing;
    }

    const inFlight = this.#pending.get(id);
    if (inFlight) return inFlight;

    const entry = this.#entries[id];
    if (!entry) throw new Error(`animation inconnue dans le manifeste : ${id}`);

    const promise = Promise.all(entry.frames.map(decodeFrame))
      .then((frames) => {
        this.#loaded.set(id, frames);
        this.#touch(id);
        this.#evictIfNeeded();
        return frames;
      })
      .finally(() => this.#pending.delete(id));

    this.#pending.set(id, promise);
    return promise;
  }

  async preload(ids: readonly AnimationId[]): Promise<void> {
    await Promise.all(ids.map((id) => this.load(id)));
  }

  #touch(id: AnimationId): void {
    const index = this.#usage.indexOf(id);
    if (index !== -1) this.#usage.splice(index, 1);
    this.#usage.push(id);
  }

  #evictIfNeeded(): void {
    const evictable = this.#usage.filter((id) => !this.#pinned.has(id));
    let excess = this.#loaded.size - this.#maxResident;

    for (const id of evictable) {
      if (excess <= 0) break;
      const frames = this.#loaded.get(id);
      if (!frames) continue;
      for (const frame of frames) frame.close();
      this.#loaded.delete(id);
      this.#usage.splice(this.#usage.indexOf(id), 1);
      excess--;
    }
  }
}

async function decodeFrame(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`frame introuvable : ${url}`);
  return createImageBitmap(await response.blob());
}
