# Sophie

Compagnon de bureau 2D kawaii pour macOS (Tauri 2 + Canvas/TypeScript).

## Prérequis

- Node 20+
- Rust (stable)
- Xcode Command Line Tools

## Installation

```bash
npm install
npm run assets          # découpe les planches de asset/ → build/frames/
npm run app             # lance en développement
```

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm run assets` | Découpe + normalisation + carnation → `build/frames/` |
| `npm run assets:one -- idle` | Une seule animation |
| `npm run assets -- --no-skin` | Sans retouche de carnation |
| `npm run assets:sheets` | Planches de contrôle dans `build/review/` |
| `npm run assets:skin` | Avant/après carnation |
| `npm run app` | Dev (Vite + Tauri) |
| `npm run app:build` | Build / empaquetage `.app` |

## Architecture

- `asset/` — sources (jamais modifiées)
- `tools/` — pipeline hors ligne (sharp)
- `build/frames/` — frames WebP générées (gitignored)
- `src/` — moteur frontend (animation, états, locomotion, curseur, comportements)
- `src-tauri/` — fenêtre transparente, curseur système, tray, shim AppKit

## Interactions

- Clic : caresse (`happy`)
- Double-clic : salue (`wave`)
- Glisser : soulève (`TakeHer`) puis chute
- Clic droit : commandes rapides
- Menu tray : danser, dormir, café, s'accrocher, quitter

Le curseur suivi est le **vrai** curseur système (API Tauri `cursor_position`).

## Autonomie

Sophie décide via un cerveau contextuel (`BehaviorBrain`) :
observation du bureau → évaluation → but (`Goal`) → déplacement → animation.

Le curseur n’est qu’un stimulus rare. Les fenêtres système sont lues via
`CGWindowList` ; le tray propose « Autoriser l’accès aux fenêtres… » pour
l’Accessibilité macOS (utile pour affiner le focused window plus tard).

## Lancement permanent sur le bureau

```bash
npm run desktop:install
```

Cela construit `Sophie.app`, la copie dans `/Applications`, et crée un LaunchAgent
qui la relance au démarrage macOS et si elle se ferme (`KeepAlive`).

Sophie flotte **au-dessus des fenêtres ordinaires et maximisées** (Safari, Cursor,
Finder, Discord en fenêtre…). Sur macOS elle utilise `CanJoinAllSpaces` +
`FullScreenAuxiliary` pour rester visible aussi sur les **Spaces de plein écran
système** (Discord / Safari / VS Code en vrai plein écran).

Elle **ne suit pas** la fenêtre active : sa position reste dans l’espace bureau.

Limitation OS : certains jeux en plein écran exclusif (shielding) peuvent masquer
tout overlay auxiliaire — aucune API publique ne le contourne proprement.

Icône dans la barre de menus pour la contrôler.

Pour désactiver :
```bash
launchctl bootout gui/$(id -u)/com.osmoz.avatar-sophie
rm ~/Library/LaunchAgents/com.osmoz.avatar-sophie.plist
```
