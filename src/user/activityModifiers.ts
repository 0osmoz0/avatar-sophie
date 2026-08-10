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
      considerationId === "excited" ||
      considerationId === "happy" ||
      considerationId === "blow_kiss"
    ) {
      f *= lowDisturb ? 0.15 : 0.4;
    }
    if (considerationId === "angry" || considerationId === "crying") {
      f *= lowDisturb ? 0.25 : 0.55;
    }
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
    if (considerationId === "excited") f *= 1.15 + social * 0.1;
    if (considerationId === "happy" || considerationId === "blow_kiss") {
      f *= 1.1 + social * 0.08;
    }
  }

  if (i.mode === "casual_browsing" || i.mode === "media_watching") {
    if (considerationId === "idle" || considerationId === "walk" || considerationId === "look") {
      f *= 1 + autonomy * 0.12;
    }
    if (considerationId === "cursor") f *= 0.7;
    if (considerationId === "excited" || considerationId === "happy") f *= 1.05;
  }

  if (i.mode === "communication") {
    if (considerationId === "cursor") f *= lowDisturb ? 0.2 : 0.45;
    if (considerationId === "idle" || considerationId === "think") f *= 1.1;
    if (considerationId === "blow_kiss" || considerationId === "happy") {
      f *= 1.12 + social * 0.1;
    }
  }

  if (i.mode === "switching_apps") {
    if (considerationId === "look") f *= 1.18;
    if (considerationId === "window") f *= 1.06;
  }

  // --- Mémoire courte (soft only, jamais d'anim forcée) ---
  const mem = ctx.memory;
  const now = ctx.now;

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

  // Fatigue contextuelle (Needs déjà dispo) — favorise repos soft.
  if (ctx.needs.fatigue >= 55 || ctx.needs.tired) {
    if (
      considerationId === "idle" ||
      considerationId === "think" ||
      considerationId === "yawn" ||
      considerationId === "coffee" ||
      considerationId === "sleep"
    ) {
      f *= 1.08;
    }
    if (considerationId === "walk" || considerationId === "dance") f *= 0.92;
  }

  // Ennui prolongé — phone / inspect / look / walk (dance seulement si musique réelle).
  if (ctx.needs.boredom >= 55 || (u.userIdle && ctx.idleSeconds > 20)) {
    if (
      considerationId === "phone_check" ||
      considerationId === "environment_inspect" ||
      considerationId === "look" ||
      considerationId === "walk"
    ) {
      f *= 1.1;
    }
    if (considerationId === "dance" && ctx.environment.musicPlaying === true) {
      f *= 1.08;
    }
  }

  // Traces Memory soft (Phase 11) — jamais de script.
  if (mem.recentWithin("phone_recent", now, 70_000)) {
    if (considerationId === "phone_check") f *= 0.78;
    if (considerationId === "phone_text") f *= 1.06;
  }
  if (mem.recentWithin("computer_recent", now, 90_000)) {
    if (considerationId.startsWith("computer_")) f *= 1.05;
    if (considerationId === "work" || considerationId === "think") f *= 1.04;
  }
  if (mem.recentWithin("window_recent", now, 80_000)) {
    if (considerationId === "window") f *= 0.85;
    if (considerationId === "look" || considerationId === "edge_peek") f *= 1.04;
  }
  if (mem.recentWithin("environment_recent", now, 70_000)) {
    if (considerationId === "environment_inspect") f *= 0.82;
    if (considerationId === "look" || considerationId === "think") f *= 1.04;
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

  if (mem.recentWithin("user_returned", now, 45_000)) {
    if (considerationId === "look") f *= 1.15;
    if (considerationId === "happy") f *= 1.18;
    // sociability soft — jamais d'anim forcée
    if (mem.sociability > 0.55 && (considerationId === "look" || considerationId === "happy")) {
      f *= 1.04;
    }
  }
  if (mem.recentWithin("user_became_idle", now, 60_000)) {
    if (
      considerationId === "look" ||
      considerationId === "window" ||
      considerationId === "perch" ||
      considerationId === "walk" ||
      considerationId === "think" ||
      considerationId === "dance"
    ) {
      f *= 1.1;
    }
    // independence → work / think / study soft
    if (
      mem.independence > 0.55 &&
      (considerationId === "work" ||
        considerationId === "think" ||
        considerationId === "study" ||
        considerationId.startsWith("computer_"))
    ) {
      f *= 1 + (mem.independence - 0.5) * 0.12;
    }
  }
  if (mem.recentWithin("user_became_busy", now, 60_000) || i.mode === "focused_work") {
    if (
      mem.independence > 0.55 &&
      (considerationId === "work" ||
        considerationId === "think" ||
        considerationId === "study" ||
        considerationId.startsWith("computer_"))
    ) {
      f *= 1 + (mem.independence - 0.5) * 0.1;
    }
    if (considerationId.startsWith("phone_")) f *= 0.55;
  }
  if (mem.recentPositiveInteraction > 0.25) {
    const boost = 1 + mem.recentPositiveInteraction * 0.12;
    if (
      considerationId === "happy" ||
      considerationId === "blow_kiss" ||
      considerationId === "dance" ||
      considerationId === "excited"
    ) {
      f *= boost;
    }
  }
  if (mem.recentFrustration > 0.25 && considerationId === "angry") {
    f *= 1 + mem.recentFrustration * 0.15;
  }

  // --- Personnalité latente (Phase 6) — soft only 0.90–1.15 ---
  f *= personalityFactor(considerationId, ctx);
  // --- Environnement (Phase 9B) — soft only 0.85–1.15 ---
  f *= environmentFactor(considerationId, ctx);

  return f;
}

/**
 * Facteurs environnementaux soft — jamais de Goal / requestState / anim forcée.
 */
export function environmentFactor(considerationId: string, ctx: BrainContext): number {
  const e = ctx.environment;
  if (!e) return 1;
  let f = 1;

  if (e.dangerousEdge) {
    if (considerationId === "edge_step_back" || considerationId === "edge_stop") f *= 1.12;
    if (considerationId === "walk") f *= 0.7;
    if (considerationId === "perch") f *= 0.5;
  } else if (e.nearEdge) {
    if (considerationId === "edge_peek" || considerationId === "edge_stop") f *= 1.08;
    if (considerationId === "walk") f *= 0.88;
  }

  if (e.nearWindow) {
    if (
      considerationId === "window" ||
      considerationId === "look" ||
      considerationId === "edge_peek" ||
      considerationId === "look_up"
    ) {
      f *= 1.08;
    }
  }

  if (e.idle && ctx.needs.curiosity >= 40) {
    if (considerationId === "environment_inspect") f *= 1.08;
    if (considerationId === "look_up" || considerationId === "look_down") f *= 1.05;
  }

  if (e.cursorApproaching && e.cursorNearby) {
    if (considerationId === "look" || considerationId === "look_over_shoulder") f *= 1.08;
    if (considerationId === "happy") f *= 1.05;
  }
  if (e.cursorLeaving) {
    if (considerationId === "look_over_shoulder") f *= 1.06;
    if (considerationId === "cursor") f *= 0.85;
  }

  if (e.focused) {
    if (
      considerationId.startsWith("phone_") ||
      considerationId === "dance" ||
      considerationId === "edge_peek"
    ) {
      f *= 0.55;
    }
    if (considerationId.startsWith("computer_")) f *= 1.08;
  }

  // Musique : uniquement si signal fiable (audioPlaying === true). Null = no boost.
  if (e.musicPlaying === true && considerationId === "dance") f *= 1.1;
  if (e.musicPlaying === null && considerationId === "dance") {
    /* no fake music boost */
  }

  if (e.inVoid && considerationId === "confused_environment") f *= 1.12;
  if (e.inVoid && considerationId === "walk") f *= 0.2;

  return Math.min(1.15, Math.max(0.85, f));
}

/**
 * Multiplicateurs personnalité × contexte.
 * Jamais d'animation forcée ; Needs/Memory cooldown restent prioritaires.
 */
export function personalityFactor(considerationId: string, ctx: BrainContext): number {
  let f = ctx.memory.personalityFactor(considerationId);
  const i = ctx.interpretedContext;
  const mem = ctx.memory;
  const ind = mem.independence;
  const social = mem.sociability;
  const cur = mem.curiosityBias;
  const play = mem.playfulness;

  if (i.mode === "focused_work" || i.mode === "gaming") {
    if (
      (considerationId === "work" ||
        considerationId === "think" ||
        considerationId === "study") &&
      ind > 0.55
    ) {
      f *= 1 + (ind - 0.5) * 0.16;
    }
    // Sociability haute : pas d'interruption forcée — happy seulement si Memory déjà pertinente.
    if (
      social > 0.6 &&
      considerationId === "happy" &&
      (mem.recentWithin("pet", ctx.now, 40_000) ||
        mem.recentWithin("user_returned", ctx.now, 45_000))
    ) {
      f *= 1.06;
    }
  }

  if (i.mode === "idle_away" || i.disturbanceTolerance === "high") {
    if (
      cur > 0.55 &&
      (considerationId === "look" ||
        considerationId === "window" ||
        considerationId === "perch")
    ) {
      f *= 1 + (cur - 0.5) * 0.18;
    }
    if (play > 0.58 && considerationId === "dance" && ctx.needs.boredom >= 48) {
      f *= 1 + (play - 0.5) * 0.14;
    }
  }

  if (mem.recentWithin("user_returned", ctx.now, 45_000) && social > 0.55) {
    if (considerationId === "happy" || considerationId === "look") {
      f *= 1 + (social - 0.5) * 0.12;
    }
  }

  return Math.min(1.15, Math.max(0.9, f));
}
