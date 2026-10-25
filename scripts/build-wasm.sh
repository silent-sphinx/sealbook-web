#!/usr/bin/env bash
set -euo pipefail
if [[ "${SKIP_WASM:-0}" == "1" ]]; then
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEALBOOK="$(cd "$ROOT/../sealbook" && pwd)"
bash "$ROOT/scripts/check-sealbook-pin.sh"
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required to build the WASM crypto module" >&2
  exit 1
fi
rustup target add wasm32-unknown-unknown >/dev/null
if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack --locked
fi
wasm-pack build "$SEALBOOK/crates/sealbook-wasm" \
  --target web \
  --release \
  --out-dir "$ROOT/src/pkg"
