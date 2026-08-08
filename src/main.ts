/**
 * Point d'entrée.
 *
 * Assemble les briques : le câblage vit ici, les décisions vivent dans
 * `state/` et `behavior/`.
 */

import { AnimationPlayer } from "./anim/AnimationPlayer";
import { AnimationRegistry } from "./anim/AnimationRegistry";
import { selectAnimation } from "./anim/AnimationSelector";
import { loadManifest } from "./assets/manifest";
import { BehaviorScheduler } from "./behavior/BehaviorScheduler";
import { Needs } from "./behavior/Needs";
import { GameLoop } from "./core/GameLoop";
import { CursorTracker } from "./input/CursorTracker";
import { hitTestSprite } from "./input/hitTest";
import { PointerInput } from "./input/PointerInput";
import { Body } from "./motion/Body";
import { Locomotion } from "./motion/Locomotion";
import { ScreenBounds } from "./motion/ScreenBounds";
import {
  fitToWorkArea,
  onCursorMove,
  onTrayAction,
  reveal,
  setClickThrough,
  setCursorTracking,
} from "./platform/tauri";
import { CanvasRenderer } from "./render/CanvasRenderer";
import { StateMachine } from "./state/StateMachine";
import { createAllStates, IdleState } from "./state/states";

/** Hauteur du personnage à l'écran, en pixels logiques. */
const PET_HEIGHT = 150;
/** Distance à laquelle Sophie remarque le curseur. */
const NOTICE_DISTANCE = 400;
/** Cooldown anti-harcèlement du Cursor Chase, en ms. */
const CHASE_COOLDOWN_MS = 20_000;

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) throw new Error("canvas #stage introuvable");

  const workArea = await fitToWorkArea();
  const manifest = await loadManifest();

  const registry = new AnimationRegistry(manifest);
  await registry.preloadEssentials();

  const scale = PET_HEIGHT / manifest.frameHeight;
  const idleEntry = manifest.animations.idle;
  const petHalfWidth = (idleEntry.frameWidth * scale) / 2;

  const bounds = new ScreenBounds(workArea);
  bounds.petHalfWidth = petHalfWidth;

  const body = new Body(workArea.width / 2, bounds.floorY);
  const locomotion = new Locomotion(bounds);
  const cursor = new CursorTracker(workArea);
  const needs = new Needs();

  const states = createAllStates();
  const idle = states.find((s) => s.id === "IDLE") ?? new IdleState();
  const machine = new StateMachine(idle, states);
  const scheduler = new BehaviorScheduler(machine, needs);

  const renderer = new CanvasRenderer(canvas);
  const player = new AnimationPlayer(registry);

  let lastChaseAt = 0;
  let clickThrough = true;
  let lastAnim = "";
  let dirtyMotion = true;

  const ctxBase = () => ({
    body,
    bounds,
    cursor,
    needs,
    now: performance.now(),
  });

  machine.start(ctxBase());
  player.play("idle");

  new PointerInput({
    canvas,
    body,
    machine,
    holdOffsetY: PET_HEIGHT * 0.35,
    onDraggingChange: () => {
      dirtyMotion = true;
    },
  });

  await onCursorMove((point) => {
    cursor.setPhysical(point.x, point.y);
  });
  await onTrayAction((action) => {
    const map: Record<string, string> = {
      dance: "DANCE",
      sleep: "SLEEP",
      coffee: "COFFEE",
      hang: "HANG",
    };
    const state = map[action];
    if (state) machine.request(state as never, true);
  });
  await setCursorTracking(true);
  await setClickThrough(true);

  const loop = new GameLoop({
    maxFps: 30,
    update: (dt) => {
      const now = performance.now();
      cursor.update(dt);

      // Cursor notice / chase depuis les états bas priorité.
      maybeChaseCursor(machine, body, cursor, now);

      const result = machine.update(ctxBase(), dt);
      needs.update(dt, machine.currentId);
      scheduler.update(now, dt);

      const motion = locomotion.apply(body, result.motion, dt);
      if (motion.landed && machine.currentId === "FALL") {
        machine.request("IDLE", true);
      }

      const animId = selectAnimation(
        { requested: result.animation, followsBody: result.followsBody },
        body,
      );
      if (animId !== lastAnim) {
        player.play(animId);
        lastAnim = animId;
      }

      player.update(dt);
      dirtyMotion = true;

      // Hit-test + click-through.
      const frames = player.frames();
      const target = { x: body.x, y: body.y, facing: body.facing, scale };
      const over = hitTestSprite(frames, target, cursor.x, cursor.y);
      if (over === clickThrough) {
        clickThrough = !over;
        void setClickThrough(clickThrough);
      }
    },
    render: () => {
      if (!player.dirty && !dirtyMotion) return false;
      player.clearDirty();
      dirtyMotion = false;
      return renderer.draw(player.frames(), {
        x: body.x,
        y: body.y,
        facing: body.facing,
        scale,
      });
    },
  });

  function maybeChaseCursor(
    sm: StateMachine,
    pet: Body,
    cur: CursorTracker,
    now: number,
  ): void {
    const id = sm.currentId;
    if (id === "DRAG" || id === "FALL" || id === "CURSOR_CHASE" || id === "CURSOR_NOTICE") {
      return;
    }
    if (now - lastChaseAt < CHASE_COOLDOWN_MS && id !== "IDLE") return;

    const headY = pet.y - PET_HEIGHT * 0.55;
    const dist = cur.distanceTo(pet.x, headY);

    if (dist < NOTICE_DISTANCE && (id === "IDLE" || id === "WALK" || id === "LOOK_AROUND")) {
      if (dist < 250 && cur.moving) {
        if (sm.request("CURSOR_CHASE")) lastChaseAt = now;
      } else if (dist < 320) {
        sm.request("CURSOR_NOTICE");
      }
    }
  }

  window.addEventListener("resize", () => {
    renderer.resize();
    dirtyMotion = true;
  });

  loop.start();
  await reveal();
}

void bootstrap().catch((error: unknown) => {
  console.error("Sophie n'a pas pu démarrer", error);
});
