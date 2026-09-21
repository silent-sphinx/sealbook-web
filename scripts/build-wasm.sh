#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ! -f "$ROOT/src/pkg/sealbook_wasm.js" || ! -f "$ROOT/src/pkg/sealbook_wasm_bg.wasm" ]]; then
  echo "src/pkg is missing the generated WASM package" >&2
  exit 1
fi
