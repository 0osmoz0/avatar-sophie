/**
 * Modificateurs contextuels UserActivity → utility.
 *
 * Règle absolue : multipliers soft UNIQUEMENT.
 * Needs + Memory (préconditions à 0 / cooldowns) restent prioritaires.
 * Jamais de forçage coffee/sleep/dance/chase.
 */

import type { BrainContext } from "../behavior/considerations/types";
import type { UserActivitySnapshot } from "./UserActivitySnapshot";

/** Applique un multiplicateur après un score déjà filtré par Needs/Memory. */
export function withUserContext(base: number, factor: number): number {
  if (base <= 0) return 0;
  return Math.max(0, base * factor);
}

export function userHint(ctx: BrainContext): string {
  const u = ctx.userActivity;
  const busy = u.userBusy ? " userBusy=true" : u.userIdle ? " userIdle=true" : "";
  return `userActivity=${u.category}/${u.overallLevel}${busy}`;
}

function longFocus(u: UserActivitySnapshot): boolean {
  return (
    (u.category === "coding" || u.category === "productivity") &&
    u.activeAppDurationSec >= 25 * 60
  );
}

/**
 * Facteurs par considération.
 * Valeurs proches de 1.0 — influence légère seulement.
 */
export function userActivityFactor(considerationId: string, ctx: BrainContext): number {
  const u = ctx.userActivity;
  let f = 1;

  if (u.userBusy) {
    if (considerationId === "cursor") f *= 0.15;
    if (considerationId === "idle") f *= 1.2;
    if (considerationId === "walk" || considerationId === "think" || considerationId === "study") {
      f *= 1.12;
    }
    if (considerationId === "work") f *= 1.15;
    if (considerationId === "dance") f *= 0.55;
  }

  if (u.userIdle) {
    if (considerationId === "look") f *= 1.25;
    if (considerationId === "window" || considerationId === "perch") f *= 1.18;
    if (considerationId === "walk") f *= 1.1;
    // Pas de boost chase : observer ≠ suivre la souris.
    if (considerationId === "cursor") f *= 1.05;
  }

  if (longFocus(u)) {
    // Soft only — Memory/Needs doivent déjà autoriser (utility > 0).
    if (considerationId === "coffee" || considerationId === "yawn") f *= 1.2;
    if (considerationId === "sleep") f *= 1.08;
    if (considerationId === "work") f *= 1.1;
    if (considerationId === "idle") f *= 1.05;
  }

  if (u.category === "gaming" && u.overallActivity >= 0.45) {
    if (considerationId === "cursor") f *= 0.05;
    if (considerationId === "dance") f *= 0.4;
    if (considerationId === "idle" || considerationId === "think") f *= 1.15;
  }

  if (u.category === "communication" && u.userBusy) {
    if (considerationId === "cursor") f *= 0.2;
  }

  // Changement d'app récent : petit boost look — jamais d'anim obligatoire.
  if (u.lastAppChangeSec < 20) {
    if (considerationId === "look") f *= 1.2;
    if (considerationId === "window") f *= 1.08;
  }

  if (u.spaceChangeSec != null && u.spaceChangeSec < 15) {
    if (considerationId === "look") f *= 1.1;
  }

  return f;
}
