#!/usr/bin/env bash
# Run Levels (API + UI) and Assets (value-scheduler) together.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run dev:all
