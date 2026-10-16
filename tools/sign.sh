#!/usr/bin/env bash
# Sign the built app with this Mac's local signing certificate, so macOS keeps
# Gamey's folder permission across rebuilds, then install it in /Applications.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="dist/mac-arm64/Gamey.app"
SIGNER="$HOME/Desktop/projects/3d/bengkel/common/sign.sh"
ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(.*Local Signing\)"$/\1/p' | head -1)"
if [ -z "$ID" ]; then
  echo "No local signing certificate: run $SIGNER --make-cert once." >&2
  exit 1
fi
# The helpers and frameworks inside an Electron app are code too; sign them all.
codesign --force --deep --sign "$ID" "$APP"
"$SIGNER" "$APP"
if [ "${1:-}" != "--no-install" ]; then
  osascript -e 'tell application "Gamey" to quit' >/dev/null 2>&1 || true
  ditto "$APP" /Applications/Gamey.app.new
  [ -d /Applications/Gamey.app ] && mv /Applications/Gamey.app "${TMPDIR:-/tmp}/Gamey.app.old.$$"
  mv /Applications/Gamey.app.new /Applications/Gamey.app
  echo "Installed /Applications/Gamey.app"
fi
