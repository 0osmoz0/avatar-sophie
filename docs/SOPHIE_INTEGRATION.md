# Sophie — Contrat d'intégration

Sophie est un compagnon de bureau autonome. Un projet externe **ne doit jamais** piloter directement `AnimationPlayer`, `StateMachine`, `Goal` ou `BehaviorBrain`.

Le seul canal autorisé est un **bus d'événements typé** qui fournit des **signaux**. Le Brain décide ensuite via le pipeline habituel.

## Architecture

```text
Projet externe
    │  SophieAPI.emit(event)
    ▼
SophieEventBus
    │
    ▼
SophieIntegration (adapter)
    │  Memory.remember / Needs soft / notifyUserActivity
    ▼
Context → Needs → Memory → Personality/Environment modifiers
    → Considerations → Utility → Novelty → Chain
    → BehaviorBrain → Goal → State → Animation
```

**Interdit :**

- `requestState` / `StateMachine.request` depuis l'extérieur
- forcer une animation / un Goal
- scheduler, quota, rotation artificielle
- exposer utilities / scores internes

## EventBus

Fichier : `src/integration/SophieEventBus.ts`

```ts
bus.emit(event)
bus.subscribe(type | "*", callback) → unsubscribe
bus.unsubscribe(type, callback)
```

## Événements entrants

| type | Effet (signaux only) |
|------|----------------------|
| `user_returned` | Memory + wake soft |
| `user_idle` | Memory `user_became_idle` + wake |
| `user_became_busy` | Memory + wake |
| `user_became_focused` | Memory + soft independence nudge |
| `pet` / `poke` / `wave` / `love` | Memory (+ Needs affection soft) — **pas** d'état immédiat |
| `app_opened` / `app_closed` | Memory + wake |
| `media_started` / `media_stopped` | Memory + wake |
| `music_started` / `music_stopped` | Memory only — **ne fake pas** `musicPlaying` |
| `external_activity` | Memory + wake |

## Payloads

```ts
{
  type: "app_opened",
  source: "external_project",
  timestamp: Date.now(),
  appId?: string,
  category?: string,
  meta?: Record<string, string | number | boolean | null>
}
```

Ne jamais passer d'objets internes (`BehaviorBrain`, `Goal`, `Consideration`, …).

## Événements sortants (haut niveau)

| type | Contenu |
|------|---------|
| `behavior_started` | `behavior` (id consideration) |
| `behavior_finished` | `behavior` (label goal) |
| `user_interaction` | `interaction` |
| `state_changed` | `state` (+ `meta.from`) |

Pas d'utilities, pas de scores, pas de détails d'implémentation d'animation.

## SophieAPI

Fichier : `src/integration/SophieAPI.ts`

```ts
import { SophieAPI } from "./integration/SophieAPI";

SophieAPI.emit({ type: "user_returned", source: "my-app" });
SophieAPI.subscribe("behavior_started", (e) => { /* … */ });
const snap = SophieAPI.getSnapshot(); // READ ONLY
```

En runtime desktop, aussi disponible via `window.Sophie.api` après boot.

### Snapshot (lecture seule)

```ts
{
  state: string;
  activity: string | null;
  userPresence: "active" | "idle" | "busy" | "unknown";
  environment: {
    nearEdge, dangerousEdge, nearWindow, hanging, focused,
    musicPlaying: boolean | null
  };
  personality: { playful, social, curiosity, calm, independence }; // [0,1]
}
```

Le snapshot est `Object.freeze` — le projet externe ne peut pas muter le runtime via cet objet.

## Exemple d'intégration

```ts
// Dans le projet hôte (après que Sophie tourne, ou via le même bundle)
SophieAPI.emit({
  type: "media_started",
  category: "music",
  source: "host-app",
  timestamp: Date.now(),
});

SophieAPI.subscribe("state_changed", (e) => {
  console.log("Sophie state:", e.state);
});

const { personality, userPresence } = SophieAPI.getSnapshot();
```

## Sécurité / invariants

1. Les événements externes **ne choisissent pas** d'animation.
2. Personality / Environment **modifient seulement** des facteurs soft ∈ bornes.
3. Needs + Memory (cooldowns, novelty) restent prioritaires.
4. Ollama reste classification-only.
5. Pas de ciblage de fenêtre frontmost pour forcer un comportement.
6. `musicPlaying` reste `null` sans source audio fiable.

## Confirmation

> Le système Sophie est maintenant stable, contextuel et intégrable. Les systèmes externes fournissent uniquement des signaux ; le Brain conserve entièrement la responsabilité de la décision comportementale.
