#!/usr/bin/env bash
# Moves the pin to the sibling sealbook checkout's current commit.
#
# Commit the new pin together with whatever change needed it, so a checkout of
# this repo at any commit names the sealbook commit it was built against.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEALBOOK="$(cd "$ROOT/../sealbook" && pwd)"
ACTUAL="$(git -C "$SEALBOOK" rev-parse HEAD)"

cat > "$ROOT/sealbook.pin" <<PIN
# The sealbook commit this repo builds its wasm module and shared fixtures from.
# Checked by scripts/check-sealbook-pin.sh; moved by scripts/update-sealbook-pin.sh.
$ACTUAL
PIN

echo "pinned sealbook at $ACTUAL"
if [[ -n "$(git -C "$SEALBOOK" status --porcelain)" ]]; then
  echo "warning: sealbook has uncommitted changes, so this pin does not describe them" >&2
fi
