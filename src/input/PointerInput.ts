/**
 * Interactions pointeur locales (clic, double-clic, glisser).
 *
 * Le click-through global est géré à l'extérieur : ce module ne reçoit des
 * événements que lorsque le hit-test a déjà basculé la fenêtre en mode interactif.
 */

import type { StateMachine } from "../state/StateMachine";
import type { Body } from "../motion/Body";
import type { Needs } from "../behavior/Needs";
import type { Memory } from "../behavior/Memory";
import {
  resolveInteraction,
  type InteractionKind,
} from "../behavior/InteractionResolver";
import { BrainDebug } from "../behavior/BrainDebug";
import { RuntimeAudit } from "../behavior/RuntimeAudit";

export interface PointerInputOptions {
  canvas: HTMLCanvasElement;
  body: Body;
  machine: StateMachine;
  /** Hauteur visuelle pour placer le personnage sous le curseur pendant le drag. */
  holdOffsetY: number;
  needs: Needs;
  memory: Memory;
  onDraggingChange?: (dragging: boolean) => void;
  /** Marqueur debug : toute commande utilisateur. */
  onUserAction?: () => void;
  /** Wake soft quand interaction différée (busy). */
  onDeferredInteraction?: (kind: InteractionKind) => void;
}

export class PointerInput {
  readonly #canvas: HTMLCanvasElement;
  readonly #body: Body;
  readonly #machine: StateMachine;
  readonly #holdOffsetY: number;
  readonly #needs: Needs;
  readonly #memory: Memory;
  readonly #onDraggingChange?: (dragging: boolean) => void;
  readonly #onUserAction?: () => void;
  readonly #onDeferredInteraction?: (kind: InteractionKind) => void;

  #pointerId: number | null = null;
  #dragging = false;
  #downAt = 0;
  #downX = 0;
  #downY = 0;
  #lastClickAt = 0;

  constructor(options: PointerInputOptions) {
    this.#canvas = options.canvas;
    this.#body = options.body;
    this.#machine = options.machine;
    this.#holdOffsetY = options.holdOffsetY;
    this.#needs = options.needs;
    this.#memory = options.memory;
    this.#onDraggingChange = options.onDraggingChange;
    this.#onUserAction = options.onUserAction;
    this.#onDeferredInteraction = options.onDeferredInteraction;

    this.#canvas.addEventListener("pointerdown", this.#onDown);
    this.#canvas.addEventListener("pointermove", this.#onMove);
    this.#canvas.addEventListener("pointerup", this.#onUp);
    this.#canvas.addEventListener("pointercancel", this.#onUp);
    this.#canvas.addEventListener("contextmenu", this.#onContext);
  }

  dispose(): void {
    this.#canvas.removeEventListener("pointerdown", this.#onDown);
    this.#canvas.removeEventListener("pointermove", this.#onMove);
    this.#canvas.removeEventListener("pointerup", this.#onUp);
    this.#canvas.removeEventListener("pointercancel", this.#onUp);
    this.#canvas.removeEventListener("contextmenu", this.#onContext);
  }

  get dragging(): boolean {
    return this.#dragging;
  }

  #applyInteraction(kind: InteractionKind): void {
    this.#onUserAction?.();
    const now = performance.now();
    const result = resolveInteraction({
      kind,
      needs: this.#needs,
      memory: this.#memory,
      stateId: this.#machine.currentId,
      now,
    });

    for (const r of result.remember) {
      this.#memory.remember(r.label, now, r.cooldownMs ?? 0);
      RuntimeAudit.remembered(r.label, this.#memory);
    }
    if (result.notePositive) this.#memory.notePositive(result.notePositive);
    if (result.noteFrustration) this.#memory.noteFrustration(result.noteFrustration);
    if (result.noteActivity) this.#memory.noteActivity(result.noteActivity);

    RuntimeAudit.interaction({
      kind,
      stateId: this.#machine.currentId,
      deferred: result.deferred,
      immediateState: result.immediateState,
      suppressReason: result.suppressReason,
      memory: this.#memory,
      now,
    });

    if (result.suppressReason) {
      const age = this.#memory.ageSec(kind, now);
      BrainDebug.suppress(
        result.immediateState?.toLowerCase() ?? kind,
        result.suppressReason,
        { ageSec: age ?? undefined },
      );
    }

    if (result.deferred) {
      this.#onDeferredInteraction?.(kind);
      return;
    }

    if (result.immediateState) {
      RuntimeAudit.state(this.#machine.currentId, result.immediateState);
      this.#machine.request(result.immediateState, true);
    }
  }

  readonly #onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.#pointerId = event.pointerId;
    this.#canvas.setPointerCapture(event.pointerId);
    this.#downAt = performance.now();
    this.#downX = event.clientX;
    this.#downY = event.clientY;
    this.#dragging = false;
  };

  readonly #onMove = (event: PointerEvent): void => {
    if (this.#pointerId !== event.pointerId) return;

    const dx = event.clientX - this.#downX;
    const dy = event.clientY - this.#downY;
    if (!this.#dragging && Math.hypot(dx, dy) > 6) {
      this.#dragging = true;
      this.#onUserAction?.();
      this.#machine.request("DRAG", true);
      this.#onDraggingChange?.(true);
    }

    if (this.#dragging) {
      this.#body.x = event.clientX;
      this.#body.y = event.clientY + this.#holdOffsetY;
      this.#body.grounded = false;
      this.#body.vx = 0;
      this.#body.vy = 0;
    }
  };

  readonly #onUp = (event: PointerEvent): void => {
    if (this.#pointerId !== event.pointerId) return;
    this.#pointerId = null;

    if (this.#dragging) {
      this.#dragging = false;
      this.#onDraggingChange?.(false);
      this.#onUserAction?.();
      this.#machine.request("FALL", true);
      return;
    }

    const now = performance.now();
    const held = now - this.#downAt;

    if (held > 400) {
      this.#applyInteraction("poke");
      return;
    }

    if (now - this.#lastClickAt < 320) {
      this.#lastClickAt = 0;
      this.#applyInteraction("wave");
      return;
    }

    this.#lastClickAt = now;
    this.#applyInteraction("pet");
  };

  readonly #onContext = (event: MouseEvent): void => {
    event.preventDefault();
    const choice = window.prompt(
      "Sophie — commande (sleep, dance, coffee, work, hang, hide)",
      "dance",
    );
    if (!choice) return;
    const map: Record<string, string> = {
      sleep: "SLEEP",
      dance: "DANCE",
      coffee: "COFFEE",
      work: "WORK",
      hang: "HANG",
      study: "STUDY",
      eat: "EAT",
      love: "LOVE",
    };
    const key = choice.trim().toLowerCase();
    if (key === "hide") {
      window.close();
      return;
    }
    if (key === "love") {
      this.#applyInteraction("love");
      return;
    }
    const state = map[key];
    if (state) {
      this.#onUserAction?.();
      this.#machine.request(state as never);
    }
  };
}
