#!/usr/bin/env bash
# Run the Sui CLI against this project's ISOLATED config dir only.
# We build in parallel with other sessions, so we must never read or write the
# global ~/.sui config or another project's keypair. SUI_CONFIG_DIR pins the CLI
# to ./.sui (gitignored — it holds the private keystore).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec env SUI_CONFIG_DIR="$ROOT/.sui" sui "$@"
