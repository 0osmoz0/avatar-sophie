/**
 * Modificateurs contextuels → utility.
 *
 * Basés surtout sur InterpretedUserContext (UserActivity = fallback).
 * Multipliers soft UNIQUEMENT. Needs + Memory prioritaires.
 * Jamais de forçage coffee/sleep/dance/chase.
 */

import type { BrainContext } from "../behavior/considerations/types";
import { formatContextHint } from "./InterpretedUserContext";

/** Applique un multiplicateur après un score déjà filtré par Needs/Memory. */
export function withUserContext(base: number, factor: number): number {
  if (base <= 0) return 0;
  return Math.max(0, base * factor);
}

export function userHint(ctx: BrainContext): string {
  const i = ctx.interpretedContext;
  const u = ctx.userActivity;
  const busy = u.userBusy ? " userBusy=true" : u.userIdle ? " userIdle=true" : "";
  return `${formatContextHint(i)}${busy}`;
}

/**
 * Facteurs par considération — vie autonome si l'utilisateur est concentré,
 * un peu plus de curiosité s'il est idle, jamais d'animation forcée.
 */
export function userActivityFactor(considerationId: string, ctx: BrainContext): number {
  const i = ctx.interpretedContext;
  const u = ctx.userActivity;
  let f = 1;

  const lowDisturb = i.disturbanceTolerance === "low";
  const highDisturb = i.disturbanceTolerance === "high";
  const autonomy = i.autonomyBias;
  const social = i.socialOpenness;

  // --- Modes principaux ---
  if (i.mode === "focused_work" || i.mode === "gaming") {
    if (considerationId === "cursor") f *= lowDisturb ? 0.12 : 0.35;
    if (considerationId === "dance") f *= 0.5;
    if (
      considerationId === "idle" ||
      considerationId === "walk" ||
      considerationId === "think" ||
      considerationId === "study" ||
      considerationId === "work"
    ) {
      f *= 1 + autonomy * 0.25;
    }
  }

  if (i.mode === "idle_away" || highDisturb) {
    if (considerationId === "look") f *= 1.2 + social * 0.15;
    if (considerationId === "window" || considerationId === "perch") f *= 1.15;
    if (considerationId === "walk") f *= 1.08;
    // Curiosité ≠ chase forcé.
    if (considerationId === "cursor") f *= 1 + social * 0.08;
  }

  if (i.mode === "casual_browsing" || i.mode === "media_watching") {
    if (considerationId === "idle" || considerationId === "walk" || considerationId === "look") {
      f *= 1 + autonomy * 0.12;
    }
    if (considerationId === "cursor") f *= 0.7;
  }

  if (i.mode === "communication") {
    if (considerationId === "cursor") f *= lowDisturb ? 0.2 : 0.45;
    if (considerationId === "idle" || considerationId === "think") f *= 1.1;
  }

  if (i.mode === "switching_apps") {
    if (considerationId === "look") f *= 1.18;
    if (considerationId === "window") f *= 1.06;
  }

  // Long focus coding (raw) — soft rest cues, Memory reste prioritaire.
  const longFocus =
    (u.category === "coding" || u.category === "productivity") &&
    u.activeAppDurationSec >= 25 * 60;
  if (longFocus) {
    if (considerationId === "coffee" || considerationId === "yawn") f *= 1.15;
    if (considerationId === "sleep") f *= 1.06;
    if (considerationId === "work") f *= 1.08;
    if (considerationId === "idle") f *= 1.05;
  }

  // Fallbacks raw si mode unknown.
  if (i.mode === "unknown") {
    if (u.userBusy && considerationId === "cursor") f *= 0.2;
    if (u.userIdle && considerationId === "look") f *= 1.15;
  }

  if (u.lastAppChangeSec < 20 && considerationId === "look") f *= 1.12;
  if (u.spaceChangeSec != null && u.spaceChangeSec < 15 && considerationId === "look") {
    f *= 1.08;
  }

  return f;
}
