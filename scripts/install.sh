#!/bin/sh
# install.sh: copy the mod and the shared core into Herdr (~/.config/herdr-app/mods/stage). Herdr hot-reloads it.
set -e
cd "$(dirname "$0")/.."
DEST="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/stage"
mkdir -p "$DEST/core" "$DEST/help"
cp mod/main.js mod/adapter.js mod/themes.js mod/mod.json "$DEST/"
cp core/*.js "$DEST/core/"
cp mod/help/*.js "$DEST/help/"   # herdr-help, copied in by ~/repos/herdr-help/sync.sh
echo "installed to $DEST"
herdr-app check "$DEST"
