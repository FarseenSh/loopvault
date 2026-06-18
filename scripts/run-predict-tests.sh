#!/usr/bin/env bash
# Gate 1: run LoopVault's atomicity tests against the REAL deepbook_predict package.
#
# The tests must live *inside* the deepbook_predict package because every
# constructor needed to stand up a mintable system (create_test_predict,
# oracle::create_oracle/create_oracle_cap, add_oracle_grid, predict_manager::new)
# is public(package) — unreachable from an external package. So we:
#   1. reproduce MystenLabs/deepbookv3 at a PINNED commit in ./external (gitignored),
#   2. copy our versioned test files into packages/predict/tests/,
#   3. run `sui move test` there.
# Our authored tests live in contracts/predict-tests/ (this repo); the cloned
# package is an attributed Apache-2.0 dependency, never committed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_URL="https://github.com/MystenLabs/deepbookv3.git"
BRANCH="predict-testnet-4-16"
PIN="1159d79af33c70e09e406310e1d8f067832ede9d"
CLONE="$ROOT/external/deepbookv3"
PKG="$CLONE/packages/predict"
SRC="$ROOT/contracts/predict-tests"

# 1. Reproduce the pinned clone if missing.
if [ ! -d "$CLONE/.git" ]; then
  echo ">> cloning $REPO_URL@$BRANCH into external/ ..."
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$CLONE"
fi
git -C "$CLONE" checkout -q "$PIN"
echo ">> deepbookv3 HEAD = $(git -C "$CLONE" rev-parse HEAD)"

# 2. Copy our test files into the package's tests/ dir.
mkdir -p "$PKG/tests"
cp "$SRC"/*.move "$PKG/tests/"
echo ">> copied: $(cd "$SRC" && ls *.move | tr '\n' ' ')"

# 3. Run the tests in this project's isolated Sui config.
export SUI_CONFIG_DIR="$ROOT/.sui"
cd "$PKG"
echo ">> sui move test ${*:-}"
sui move test "$@"
