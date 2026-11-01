#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$TASK_ROOT/scripts/release/build.cjs" "$@"
