#!/bin/sh
# install.sh: copy the mod and the shared core into Herdr (~/.config/herdr-app/mods/stage). Herdr hot-reloads it.
set -e
cd "$(dirname "$0")/.."
DEST="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/stage"
mkdir -p "$DEST/core"
cp mod/main.js mod/adapter.js mod/themes.js mod/mod.json "$DEST/"
cp core/*.js "$DEST/core/"
echo "installed to $DEST"
herdr-app check "$DEST"
