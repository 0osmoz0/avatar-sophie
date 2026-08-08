/**
 * Pont vers le backend Tauri.
 *
 * Tout le reste du frontend passe par ici : aucun autre module n'importe
 * `@tauri-apps/api`, ce qui permet de faire tourner le moteur dans un simple
 * navigateur pour le développement.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface CursorPoint {
  /** Pixels physiques, origine au coin supérieur gauche du bureau. */
  x: number;
  y: number;
}

/** Vrai lorsque le code s'exécute réellement dans la fenêtre Tauri. */
export const isTauri = "__TAURI_INTERNALS__" in window;

/** Zone utile de l'écran principal, barre de menus et Dock exclus. */
export async function fitToWorkArea(): Promise<WorkArea> {
  if (!isTauri) {
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      scaleFactor: window.devicePixelRatio,
    };
  }
  return invoke<WorkArea>("fit_to_work_area");
}

/**
 * Laisse ou non passer les clics vers les fenêtres situées derrière. Le
 * compagnon est transparent aux clics par défaut ; on ne repasse à `false` que
 * lorsque le pointeur touche un pixel opaque du personnage.
 */
export async function setClickThrough(ignore: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_click_through", { ignore });
}

/** Affiche la fenêtre, une fois les assets prêts, pour éviter un flash vide. */
export async function reveal(): Promise<void> {
  if (!isTauri) return;
  await invoke("reveal");
}

export async function setCursorTracking(enabled: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_cursor_tracking", { enabled });
}

/**
 * S'abonne au vrai curseur système. Le backend n'émet que sur déplacement
 * effectif, il n'y a donc pas de flot continu quand la souris est immobile.
 */
export async function onCursorMove(handler: (point: CursorPoint) => void): Promise<() => void> {
  if (!isTauri) {
    // Repli navigateur : seul le pointeur au-dessus de la page est visible.
    const listener = (event: PointerEvent) => {
      handler({
        x: event.clientX * window.devicePixelRatio,
        y: event.clientY * window.devicePixelRatio,
      });
    };
    window.addEventListener("pointermove", listener);
    return () => window.removeEventListener("pointermove", listener);
  }

  return listen<CursorPoint>("cursor:move", (event) => handler(event.payload));
}

/** Actions du menu tray (dance, sleep, coffee, hang…). */
export async function onTrayAction(handler: (action: string) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  return listen<string>("tray:action", (event) => handler(event.payload));
}
