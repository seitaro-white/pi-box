#!/usr/bin/env bash
# Explicit opt-in: run host tests, then smoke-test both prebuilt images.
set -euo pipefail
cd "$(dirname "$0")/.."

npm test
PI_BOX_PROFILE=recommended PI_BOX_IMAGE="${PI_BOX_RECOMMENDED_IMAGE:-pi-box:0.2.0}" bash tests/smoke.sh
PI_BOX_PROFILE=base PI_BOX_IMAGE="${PI_BOX_BASE_IMAGE:-pi-box:0.2.0-base}" bash tests/smoke.sh
