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
# A system rustc (Homebrew, for one) can sit ahead of rustup's on PATH and has no
# wasm target, so build with the toolchain the target was just added to.
PATH="$(dirname "$(rustup which rustc)"):$PATH"
export PATH
if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack --locked
fi
wasm-pack build "$SEALBOOK/crates/sealbook-wasm" \
  --target web \
  --release \
  --out-dir "$ROOT/src/pkg"
