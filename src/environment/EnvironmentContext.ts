/**
 * EnvironmentContext — lecture seule.
 * Ne choisit jamais d'animation / Goal / State.
 */

import type { Body } from "../motion/Body";
import type { CursorTracker } from "../input/CursorTracker";
import type { WorldSnapshot, EdgeAnchor } from "../world/types";
import type { StateId } from "../state/types";
import type { InterpretedUserContext } from "../user/InterpretedUserContext";
import type { UserActivitySnapshot } from "../user/UserActivitySnapshot";

/** Seuils centralisés (px / unités runtime). */
export const ENV_THRESHOLDS = {
  nearEdgePx: 72,
  dangerousEdgePx: 28,
  nearCornerPx: 96,
  nearWindowPx: 420,
  nearPerchPx: 380,
  cursorNearPx: 200,
  cursorApproachDeltaPx: 6,
  petHalfWidthDefault: 40,
  edgeMargin: 24,
} as const;

export interface EnvironmentContext {
  screenWidth: number;
  screenHeight: number;
  minX: number;
  maxX: number;
  x: number;
  y: number;

  distanceToLeftEdge: number;
  distanceToRightEdge: number;
  distanceToTopEdge: number;
  distanceToBottomEdge: number;

  nearLeftEdge: boolean;
  nearRightEdge: boolean;
  nearTopEdge: boolean;
  nearBottomEdge: boolean;
  nearEdge: boolean;
  atEdge: boolean;
  dangerousEdge: boolean;
  movingTowardEdge: boolean;

  nearCorner: boolean;

  hasValidSurface: boolean;
  surfaceBelow: number;
  distanceToSurface: number;
  onValidSurface: boolean;

  inVoid: boolean;
  falling: boolean;
  hanging: boolean;

  nearWindow: boolean;
  nearPerch: boolean;
  perchAvailable: boolean;
  safeToPerch: boolean;
  nearestEdge: EdgeAnchor | null;

  cursorDistance: number;
  cursorMoving: boolean;
  cursorApproaching: boolean;
  cursorLeaving: boolean;
  cursorNearby: boolean;

  focused: boolean;
  idle: boolean;
  returned: boolean;
  busy: boolean;

  /** Toujours unknown tant que audioPlaying runtime = null. */
  audioPlaying: boolean | null;
  musicPlaying: boolean | null;
  mediaCategory: boolean;
}

/** Stub pour tests / smokes — bornes 1440×900, sol. */
export function emptyEnvironment(
  partial?: Partial<EnvironmentContext>,
): EnvironmentContext {
  const base = deriveEnvironment({
    body: {
      x: 400,
      y: 900,
      vx: 0,
      vy: 0,
      grounded: true,
    } as Body,
    world: {
      originX: 0,
      originY: 0,
      width: 1440,
      height: 900,
      scaleFactor: 1,
      monitors: [],
      windows: [],
      accessibilityTrusted: true,
      nearestWindow: null,
      nearestEdge: null,
      points: [],
      updatedAt: 0,
    },
    cursor: {
      x: 0,
      y: 0,
      moving: false,
      distanceTo: () => 999,
    } as unknown as CursorTracker,
    interpreted: {
      mode: "unknown",
      confidence: 0.5,
      disturbanceTolerance: "medium",
      socialOpenness: 0.5,
      autonomyBias: 0.5,
      source: "rules",
      summary: "",
      raw: null as unknown as UserActivitySnapshot,
    },
    userActivity: {
      category: "unknown",
      userBusy: false,
      userIdle: false,
      audioPlaying: null,
    } as UserActivitySnapshot,
    stateId: "IDLE",
  });
  return { ...base, ...partial };
}

export interface EnvDeriveInput {
  body: Body;
  world: WorldSnapshot;
  cursor: CursorTracker;
  interpreted: InterpretedUserContext;
  userActivity: UserActivitySnapshot;
  stateId: StateId;
  memoryReturned?: boolean;
  petHalfWidth?: number;
  prevCursorDistance?: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function deriveEnvironment(input: EnvDeriveInput): EnvironmentContext {
  const half = input.petHalfWidth ?? ENV_THRESHOLDS.petHalfWidthDefault;
  const margin = ENV_THRESHOLDS.edgeMargin;
  const w = Math.max(1, input.world.width);
  const h = Math.max(1, input.world.height);
  const minX = margin + half;
  const maxX = w - margin - half;
  const x = input.body.x;
  const y = input.body.y;

  const distanceToLeftEdge = x - minX;
  const distanceToRightEdge = maxX - x;
  const floorY = h; // work floor approx ; multi-monitor detail via world.floor elsewhere
  const distanceToTopEdge = y;
  const distanceToBottomEdge = floorY - y;

  const nearLeftEdge = distanceToLeftEdge <= ENV_THRESHOLDS.nearEdgePx;
  const nearRightEdge = distanceToRightEdge <= ENV_THRESHOLDS.nearEdgePx;
  const nearTopEdge = distanceToTopEdge <= ENV_THRESHOLDS.nearEdgePx;
  const nearBottomEdge = distanceToBottomEdge <= ENV_THRESHOLDS.nearEdgePx;
  const nearEdge = nearLeftEdge || nearRightEdge;
  const atEdge =
    distanceToLeftEdge <= 2 || distanceToRightEdge <= 2;
  const dangerousEdge =
    distanceToLeftEdge <= ENV_THRESHOLDS.dangerousEdgePx ||
    distanceToRightEdge <= ENV_THRESHOLDS.dangerousEdgePx;

  const vx = input.body.vx;
  const movingTowardEdge =
    (nearLeftEdge && vx < -8) ||
    (nearRightEdge && vx > 8) ||
    (dangerousEdge && Math.abs(vx) > 5);

  const nearCorner =
    (nearLeftEdge || nearRightEdge) &&
    distanceToBottomEdge <= ENV_THRESHOLDS.nearCornerPx;

  const hanging = input.stateId === "HANG";
  const falling = input.stateId === "FALL" || (!input.body.grounded && input.body.vy > 40);
  const surfaceBelow = floorY;
  const distanceToSurface = Math.max(0, floorY - y);
  const hasValidSurface =
    input.body.grounded ||
    (hanging && input.world.nearestEdge != null) ||
    falling;
  const onValidSurface = input.body.grounded === true;
  const inVoid =
    !input.body.grounded &&
    !hanging &&
    !falling &&
    distanceToSurface > 40;

  const edge = input.world.nearestEdge;
  const nearPerch =
    !!edge && Math.abs(edge.x - x) <= ENV_THRESHOLDS.nearPerchPx;
  const win = input.world.nearestWindow;
  let nearWindow = false;
  if (win) {
    const cx = win.x + win.width / 2;
    nearWindow = Math.abs(cx - x) <= ENV_THRESHOLDS.nearWindowPx;
  }
  const perchAvailable = nearPerch && edge != null;
  const safeToPerch =
    perchAvailable &&
    !dangerousEdge &&
    (edge!.kind === "screen-top" ||
      edge!.kind === "window-top" ||
      edge!.kind === "screen-left" ||
      edge!.kind === "screen-right" ||
      edge!.kind === "window-side");

  const headY = y - 80;
  const cursorDistance = input.cursor.distanceTo(x, headY);
  const cursorMoving = input.cursor.moving;
  const prev = input.prevCursorDistance ?? cursorDistance;
  const cursorApproaching =
    cursorMoving && cursorDistance < prev - ENV_THRESHOLDS.cursorApproachDeltaPx;
  const cursorLeaving =
    cursorMoving && cursorDistance > prev + ENV_THRESHOLDS.cursorApproachDeltaPx;
  const cursorNearby = cursorDistance <= ENV_THRESHOLDS.cursorNearPx;

  const mode = input.interpreted.mode;
  const focused = mode === "focused_work" || mode === "gaming";
  const idle = input.userActivity.userIdle || mode === "idle_away";
  const busy = input.userActivity.userBusy;
  const returned = input.memoryReturned === true;

  const audioPlaying = input.userActivity.audioPlaying; // null today
  const mediaCategory = input.userActivity.category === "media";
  const musicPlaying: boolean | null =
    audioPlaying === null ? null : audioPlaying === true;

  void clamp01;

  return {
    screenWidth: w,
    screenHeight: h,
    minX,
    maxX,
    x,
    y,
    distanceToLeftEdge,
    distanceToRightEdge,
    distanceToTopEdge,
    distanceToBottomEdge,
    nearLeftEdge,
    nearRightEdge,
    nearTopEdge,
    nearBottomEdge,
    nearEdge,
    atEdge,
    dangerousEdge,
    movingTowardEdge,
    nearCorner,
    hasValidSurface,
    surfaceBelow,
    distanceToSurface,
    onValidSurface,
    inVoid,
    falling,
    hanging,
    nearWindow,
    nearPerch,
    perchAvailable,
    safeToPerch,
    nearestEdge: edge,
    cursorDistance,
    cursorMoving,
    cursorApproaching,
    cursorLeaving,
    cursorNearby,
    focused,
    idle,
    returned,
    busy,
    audioPlaying,
    musicPlaying,
    mediaCategory,
  };
}

/**
 * Trajectoire horizontale compatible avec les bornes / surface.
 * N'interrompt pas un goal — sert à filtrer les utilities.
 */
export function isSafeMovement(
  env: EnvironmentContext,
  direction: -1 | 0 | 1,
  distancePx: number,
): boolean {
  if (direction === 0) return true;
  if (env.inVoid && !env.hanging) return false;
  const target = env.x + direction * Math.abs(distancePx);
  if (target < env.minX + 4 || target > env.maxX - 4) return false;
  if (direction < 0 && env.distanceToLeftEdge < ENV_THRESHOLDS.dangerousEdgePx) {
    return false;
  }
  if (direction > 0 && env.distanceToRightEdge < ENV_THRESHOLDS.dangerousEdgePx) {
    return false;
  }
  return true;
}

/** Ancre perch encore plausible (surface live). */
export function isPerchAnchorValid(
  world: WorldSnapshot,
  anchor: EdgeAnchor,
  bodyX: number,
): boolean {
  const e = world.nearestEdge;
  if (!e) return false;
  if (Math.abs(e.x - anchor.x) > 140) return false;
  if (Math.abs(e.y - anchor.y) > 160) return false;
  if (Math.abs(bodyX - anchor.x) > 220) return false;
  return true;
}

/** Tracker léger pour cursorApproaching / Leaving. */
export class EnvironmentTracker {
  #prevCursorDistance = 0;
  #petHalfWidth = ENV_THRESHOLDS.petHalfWidthDefault as number;

  setPetHalfWidth(v: number): void {
    this.#petHalfWidth = v;
  }

  update(input: Omit<EnvDeriveInput, "prevCursorDistance" | "petHalfWidth">): EnvironmentContext {
    const env = deriveEnvironment({
      ...input,
      petHalfWidth: this.#petHalfWidth,
      prevCursorDistance: this.#prevCursorDistance,
    });
    this.#prevCursorDistance = env.cursorDistance;
    return env;
  }
}
