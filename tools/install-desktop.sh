#!/usr/bin/env bash
# Installe Sophie comme compagnon permanent du bureau macOS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Sophie"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_ID="com.osmoz.avatar-sophie"
PLIST="$LAUNCH_AGENTS/${PLIST_ID}.plist"
APP_DST="/Applications/${APP_NAME}.app"

cd "$ROOT"

find_built_app() {
  local candidates=(
    "$ROOT/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
    "${CARGO_TARGET_DIR:-}/release/bundle/macos/${APP_NAME}.app"
  )
  # Cherche aussi dans le cache Cursor / cargo-target.
  while IFS= read -r path; do
    candidates+=("$path")
  done < <(find /var/folders -path "*/release/bundle/macos/${APP_NAME}.app" -type d 2>/dev/null | head -5)

  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -d "$candidate" && -f "$candidate/Contents/Info.plist" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ ! -f build/manifest.json ]]; then
  echo "→ Génération des assets…"
  npm run assets
fi

# Toujours reconstruire sauf SOPHIE_SKIP_BUILD=1 (sinon on réinstalle un vieux
# bundle du cache cargo sans les derniers correctifs).
if [[ "${SOPHIE_SKIP_BUILD:-}" != "1" ]]; then
  echo "→ Build release…"
  npm run app:build
fi

APP_SRC="$(find_built_app || true)"
if [[ -z "${APP_SRC}" ]]; then
  echo "→ Build release…"
  npm run app:build
  APP_SRC="$(find_built_app || true)"
fi

if [[ -z "${APP_SRC}" || ! -d "$APP_SRC" ]]; then
  echo "Build introuvable (Sophie.app)." >&2
  exit 1
fi

echo "→ Bundle trouvé : $APP_SRC"

EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_SRC/Contents/Info.plist" 2>/dev/null || echo avatar-sophie)"

echo "→ Arrêt des instances en cours…"
pkill -f "/Applications/Sophie.app" 2>/dev/null || true
pkill -f "Sophie.app/Contents/MacOS" 2>/dev/null || true
pkill -f "cargo-target/.*/avatar-sophie" 2>/dev/null || true
pkill -f "target/.*/avatar-sophie" 2>/dev/null || true
sleep 1

echo "→ Installation dans /Applications…"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

BIN="$APP_DST/Contents/MacOS/$EXECUTABLE"
if [[ ! -x "$BIN" ]]; then
  echo "Binaire introuvable : $BIN" >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${PLIST_ID}" 2>/dev/null || true
sleep 1
# `bootstrap` echoue souvent si le job existe deja a moitie : on reessaie puis open.
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST" 2>/dev/null || true
fi
launchctl enable "gui/$(id -u)/${PLIST_ID}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${PLIST_ID}" 2>/dev/null || open -a "$APP_DST"

sleep 1
if pgrep -f "$BIN" >/dev/null; then
  echo
  echo "Sophie est installée et tourne sur ton bureau."
else
  echo
  echo "Installation OK — lancement via open…"
  open -a "$APP_DST"
fi

echo "  App      : $APP_DST"
echo "  Autostart: $PLIST (KeepAlive = redémarre si tu quittes)"
echo "  Tray     : icône dans la barre de menus"
echo
echo "Elle flotte au-dessus de toutes tes fenêtres (pas seulement le navigateur)."
echo
echo "Pour désactiver :"
echo "  launchctl bootout gui/\$(id -u)/${PLIST_ID}"
echo "  rm \"$PLIST\""
echo "  rm -rf \"$APP_DST\""
