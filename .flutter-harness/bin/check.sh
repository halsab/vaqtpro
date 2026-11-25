#!/usr/bin/env bash
# Compatibility entry point; the Python runner owns step execution and reports.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec python3 "$HERE/check-runner.py" "$@"
