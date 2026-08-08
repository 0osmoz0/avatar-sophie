import type { StateId } from "../state/types";
import type { Needs } from "./Needs";

export interface BehaviorContext {
  hourOfDay: number;
  needs: Needs;
  idleSeconds: number;
}

export interface BehaviorDef {
  id: string;
  state: StateId;
  weight: number;
  minDuration: number;
  maxDuration: number;
  cooldown: number;
  priority: number;
  condition?: (ctx: BehaviorContext) => boolean;
}

/**
 * Comportements autonomes pilotés par données.
 *
 * Pas de changement toutes les deux secondes : l'ordonnanceur n'agit que depuis
 * IDLE, après un délai aléatoire, et respecte les cooldowns.
 */
export const BEHAVIORS: BehaviorDef[] = [
  {
    id: "walk",
    state: "WALK",
    weight: 28,
    minDuration: 4,
    maxDuration: 10,
    cooldown: 12_000,
    priority: 10,
  },
  {
    id: "look",
    state: "LOOK_AROUND",
    weight: 18,
    minDuration: 3,
    maxDuration: 6,
    cooldown: 20_000,
    priority: 5,
  },
  {
    id: "yawn",
    state: "YAWN",
    weight: 8,
    minDuration: 2,
    maxDuration: 3,
    cooldown: 90_000,
    priority: 15,
    condition: (ctx) => ctx.needs.fatigue > 40 || ctx.hourOfDay >= 22 || ctx.hourOfDay < 7,
  },
  {
    id: "sleep",
    state: "SLEEP",
    weight: 10,
    minDuration: 10,
    maxDuration: 20,
    cooldown: 180_000,
    priority: 20,
    condition: (ctx) => ctx.needs.tired || ctx.hourOfDay >= 23 || ctx.hourOfDay < 6,
  },
  {
    id: "coffee",
    state: "COFFEE",
    weight: 10,
    minDuration: 6,
    maxDuration: 12,
    cooldown: 180_000,
    priority: 20,
    condition: (ctx) => ctx.hourOfDay >= 7 && ctx.hourOfDay <= 11,
  },
  {
    id: "work",
    state: "WORK",
    weight: 14,
    minDuration: 8,
    maxDuration: 16,
    cooldown: 120_000,
    priority: 20,
    condition: (ctx) => ctx.hourOfDay >= 9 && ctx.hourOfDay <= 18 && !ctx.needs.exhausted,
  },
  {
    id: "study",
    state: "STUDY",
    weight: 10,
    minDuration: 8,
    maxDuration: 14,
    cooldown: 150_000,
    priority: 20,
    condition: (ctx) => ctx.hourOfDay >= 8 && ctx.hourOfDay <= 22,
  },
  {
    id: "eat",
    state: "EAT",
    weight: 8,
    minDuration: 5,
    maxDuration: 10,
    cooldown: 200_000,
    priority: 20,
    condition: (ctx) => [8, 12, 13, 19, 20].includes(ctx.hourOfDay),
  },
  {
    id: "think",
    state: "THINK",
    weight: 10,
    minDuration: 4,
    maxDuration: 8,
    cooldown: 60_000,
    priority: 18,
  },
  {
    id: "dance",
    state: "DANCE",
    weight: 4,
    minDuration: 6,
    maxDuration: 12,
    cooldown: 300_000,
    priority: 22,
    condition: (ctx) => ctx.needs.boredom > 50,
  },
  {
    id: "hang",
    state: "HANG",
    weight: 5,
    minDuration: 5,
    maxDuration: 10,
    cooldown: 240_000,
    priority: 40,
  },
];
