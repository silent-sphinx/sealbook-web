#!/usr/bin/env bash
# Fails unless the sibling sealbook checkout is at the commit this repo pins.
#
# The wasm module, the shared fixtures and (from phase 1 of the client
# unification) the protocol decisions all come from that checkout, so a build
# is only reproducible if which commit it came from is recorded here.
#
# Move the pin with: scripts/update-sealbook-pin.sh
# Build against another commit once with: ALLOW_UNPINNED_SEALBOOK=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN_FILE="$ROOT/sealbook.pin"
SEALBOOK="$(cd "$ROOT/../sealbook" 2>/dev/null && pwd)" || {
  echo "sealbook is not checked out beside this repo" >&2
  exit 1
}

[[ -f "$PIN_FILE" ]] || { echo "missing $PIN_FILE" >&2; exit 1; }
PINNED="$(grep -v '^[[:space:]]*#' "$PIN_FILE" | tr -d '[:space:]' | head -c 40)"
ACTUAL="$(git -C "$SEALBOOK" rev-parse HEAD)"

if [[ "$PINNED" != "$ACTUAL" ]]; then
  echo "sealbook checkout does not match the pin:" >&2
  echo "  pinned: $PINNED" >&2
  echo "  actual: $ACTUAL" >&2
  echo "Check out the pinned commit, or run scripts/update-sealbook-pin.sh to move the pin." >&2
  if [[ "${ALLOW_UNPINNED_SEALBOOK:-0}" == "1" ]]; then
    echo "ALLOW_UNPINNED_SEALBOOK=1: continuing anyway." >&2
    exit 0
  fi
  exit 1
fi

# Local edits are normal while developing, and the pin still names the commit
# they are on top of, so this is a warning rather than a failure.
if [[ -n "$(git -C "$SEALBOOK" status --porcelain)" ]]; then
  echo "note: sealbook has uncommitted changes; this build is not reproducible from the pin alone" >&2
fi
