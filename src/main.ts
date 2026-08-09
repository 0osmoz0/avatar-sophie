/**
 * Point d'entrée — câblage observe → décider → se déplacer → animer.
 */

import { AnimationPlayer } from "./anim/AnimationPlayer";
import { AnimationRegistry } from "./anim/AnimationRegistry";
import { selectAnimation } from "./anim/AnimationSelector";
import { loadManifest } from "./assets/manifest";
import { BehaviorBrain } from "./behavior/BehaviorBrain";
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
import { LocalContextInterpreter } from "./user/LocalContextInterpreter";
import { UserActivityModel } from "./user/UserActivityModel";
import { WorldModel } from "./world/WorldModel";

const PET_HEIGHT = 150;

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

  const world = new WorldModel(workArea);
  await world.bootstrap();

  // Recaler l'overlay si l'union a changé après le premier fetch.
  if (
    Math.abs(world.width - workArea.width) > 2 ||
    Math.abs(world.height - workArea.height) > 2
  ) {
    await fitToWorkArea();
  }

  const bounds = new ScreenBounds(world);
  bounds.petHalfWidth = petHalfWidth;

  const primary =
    world.snapshot.monitors.find((m) => m.primary) ?? world.snapshot.monitors[0];
  const spawnX = primary
    ? primary.workX + primary.workWidth / 2 - world.originX
    : world.width / 2;
  const body = new Body(spawnX, bounds.floorYAt(spawnX));
  const locomotion = new Locomotion(bounds);
  const cursor = new CursorTracker({
    x: world.originX,
    y: world.originY,
    width: world.width,
    height: world.height,
    scaleFactor: world.scaleFactor,
  });
  const needs = new Needs();

  const states = createAllStates();
  const idle = states.find((s) => s.id === "IDLE") ?? new IdleState();
  const machine = new StateMachine(idle, states);
  const brain = new BehaviorBrain(machine, needs);
  const userActivity = new UserActivityModel();
  await userActivity.start();
  const contextInterpreter = new LocalContextInterpreter();

  // Debug : localStorage.sophieDebugBrain / sophieUseOllama = "1"
  window.Sophie = {
    ...window.Sophie,
    debugBrain: window.Sophie?.debugBrain ?? localStorage.getItem("sophieDebugBrain") === "1",
    useOllama: window.Sophie?.useOllama ?? localStorage.getItem("sophieUseOllama") === "1",
    lastDecision: null,
    lastUserActivity: null,
    lastContext: null,
  };

  const renderer = new CanvasRenderer(canvas);
  const player = new AnimationPlayer(registry);

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
    onDraggingChange: (dragging) => {
      dirtyMotion = true;
      if (dragging) brain.clearGoal();
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
    if (state) {
      brain.clearGoal();
      machine.request(state as never, true);
    }
  });
  await setCursorTracking(true);
  await setClickThrough(true);

  const loop = new GameLoop({
    maxFps: 30,
    update: (dt) => {
      const now = performance.now();
      cursor.update(dt);

      const snap = world.observe(body, now);
      cursor.setWorkArea({
        x: snap.originX,
        y: snap.originY,
        width: snap.width,
        height: snap.height,
        scaleFactor: snap.scaleFactor,
      });

      const activity = userActivity.update(now, cursor);
      const signals = userActivity.drainSignals();
      for (const signal of signals) {
        // Wake soft uniquement — jamais de goal spatial vers l'app active.
        brain.notifyUserActivity(signal);
      }
      const interpreted = contextInterpreter.update(activity, signals);

      const decision = brain.update(now, dt, body, cursor, snap, activity, interpreted);
      if (decision.requestState) {
        machine.request(decision.requestState, decision.forceState ?? false);
      }

      const result = machine.update(ctxBase(), dt);
      needs.update(dt, machine.currentId);

      // Le cerveau impose le déplacement (goTo / chase / perch / fall).
      // Les activités stationnaires gardent le motion idle de l'état.
      const stationary = [
        "WORK",
        "SLEEP",
        "COFFEE",
        "STUDY",
        "DANCE",
        "EAT",
        "THINK",
        "PUSH",
        "PULL",
        "LOOK_AROUND",
        "YAWN",
        "SURPRISE",
        "PET",
        "WAVE",
        "HAPPY",
        "OVERWORK",
      ].includes(machine.currentId);

      const intent = stationary ? result.motion : decision.motion;
      const motion = locomotion.apply(body, intent, dt);

      if (motion.landed) {
        brain.notifyLanded();
        if (machine.currentId === "FALL") machine.request("IDLE", true);
      }

      const followsBody =
        result.followsBody || decision.animationHint === "followBody";
      const animId = selectAnimation(
        { requested: result.animation, followsBody },
        body,
      );
      if (animId !== lastAnim) {
        player.play(animId);
        lastAnim = animId;
      }

      player.update(dt);
      dirtyMotion = true;

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

  const syncCanvasToWindow = (): void => {
    // Tant que la fenetre est `visible:false`, innerWidth/Height restent a la
    // taille initiale (800x600) : Sophie etait dessinee hors du canvas.
    renderer.resize();
    dirtyMotion = true;
  };

  window.addEventListener("resize", syncCanvasToWindow);

  loop.start();
  await reveal();
  // Recaler apres show : le WKWebView n'a les bonnes dimensions qu'une fois visible.
  await fitToWorkArea();
  syncCanvasToWindow();
  // Second passage au prochain frame (layout async).
  requestAnimationFrame(() => {
    syncCanvasToWindow();
    body.x = Math.min(Math.max(body.x, petHalfWidth), world.width - petHalfWidth);
    body.y = bounds.floorYAt(body.x);
    dirtyMotion = true;
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Sophie n'a pas pu démarrer", error);
});
