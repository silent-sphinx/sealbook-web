#!/usr/bin/env bash
# Checks that an older release reads what this tree's core writes.
#
# Usage: scripts/check-older-reader.sh [TAG]
#
# TAG defaults to the newest release tag. The release is checked out into a
# temporary worktree, src/test/readerDump.test.ts is copied in, and both trees
# dump their readers' view of every payload in core's write tables. The dumps
# are then compared by scripts/compare-reader-dumps.mjs, which skips the
# differences listed for TAG in scripts/older-reader-accepted.txt.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-$(git -C "$here" tag --sort=-v:refname | head -n 1)}"
fixtures="$(cd "$here/../sealbook/crates/sealbook-protocol/fixtures" && pwd)"
work="$(mktemp -d)"
sealbook="$(cd "$here/../sealbook" && pwd)"
cleanup() {
  git -C "$here" worktree remove --force "$work/older" >/dev/null 2>&1 || true
  git -C "$sealbook" worktree remove --force "$work/sealbook" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

git -C "$here" worktree add --detach "$work/older" "$tag" >/dev/null
ln -s "$here/node_modules" "$work/older/node_modules"
cp "$here/src/test/readerDump.test.ts" "$work/older/src/test/"

# A release with a sealbook pin reads through core, so its wasm package is built
# from the pinned commit, which its build script finds at ../sealbook.
if [[ -f "$work/older/sealbook.pin" ]]; then
  pin="$(grep -v '^[[:space:]]*#' "$work/older/sealbook.pin" | tr -d '[:space:]')"
  git -C "$sealbook" worktree add --detach "$work/sealbook" "$pin" >/dev/null
  bash "$work/older/scripts/build-wasm.sh" >/dev/null 2>&1
fi

dump() {
  (cd "$1" && READER_DUMP="$2" SEALBOOK_FIXTURES="$fixtures" \
    npx vitest run src/test/readerDump.test.ts >/dev/null)
}

dump "$work/older" "$work/older.json"
dump "$here" "$work/newer.json"
echo "older reader: $tag"
node "$here/scripts/compare-reader-dumps.mjs" "$work/older.json" "$work/newer.json" \
  "$tag" "$here/scripts/older-reader-accepted.txt"
