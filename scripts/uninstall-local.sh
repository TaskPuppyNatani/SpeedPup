#!/usr/bin/env bash
set -euo pipefail

UUID="speedpup@taskpuppynatani"
TARGET="$HOME/.local/share/cinnamon/desklets/$UUID"

rm -rf "$TARGET"
echo "Removed local SpeedPup development copy:"
echo "  $TARGET"
