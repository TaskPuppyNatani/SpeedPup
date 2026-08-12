#!/usr/bin/env bash
set -euo pipefail

UUID="speedpup@taskpuppynatani"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/$UUID/files/$UUID"
TARGET="$HOME/.local/share/cinnamon/desklets/$UUID"

mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"
cp -a "$SOURCE" "$TARGET"

echo "Installed SpeedPup to:"
echo "  $TARGET"
echo
echo "Now open System Settings -> Desklets and add SpeedPup."
