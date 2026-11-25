#!/usr/bin/env bash
# Portable Maestro MCP/CLI entry point, installed inside each Flutter project.
set -euo pipefail
die() { printf 'BLOCKED Maestro: %s\n' "$*" >&2; exit 3; }

if [[ -n "${MAESTRO_BIN:-}" ]]; then
  [[ -x "$MAESTRO_BIN" ]] || die "MAESTRO_BIN not executable: $MAESTRO_BIN"
  maestro_bin="$MAESTRO_BIN"
elif command -v maestro >/dev/null 2>&1; then
  maestro_bin="$(command -v maestro)"
elif [[ -x "$HOME/.maestro/bin/maestro" ]]; then
  maestro_bin="$HOME/.maestro/bin/maestro"
else
  die "Maestro CLI missing: install it or set MAESTRO_BIN."
fi

if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
  :
elif [[ -n "${ANDROID_STUDIO_JBR:-}" && -x "$ANDROID_STUDIO_JBR/bin/java" ]]; then
  export JAVA_HOME="$ANDROID_STUDIO_JBR"
else
  unset JAVA_HOME
  if [[ "$(uname -s)" == "Darwin" ]]; then
    for candidate in \
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
      "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
      if [[ -x "$candidate/bin/java" ]]; then
        export JAVA_HOME="$candidate"
        break
      fi
    done
  fi
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  "$JAVA_HOME/bin/java" -version >/dev/null 2>&1 || die "JDK failed: $JAVA_HOME"
elif command -v java >/dev/null 2>&1; then
  java -version >/dev/null 2>&1 || die "java from PATH failed; set JAVA_HOME."
else
  die "Java unavailable; set JAVA_HOME or ANDROID_STUDIO_JBR."
fi

if [[ "${1:-}" == "--check" ]]; then
  printf 'PASS Maestro executable: %s\n' "$maestro_bin"
  if [[ -n "${JAVA_HOME:-}" ]]; then
    printf 'PASS Java home: %s\n' "$JAVA_HOME"
  else
    printf 'PASS Java from PATH: %s\n' "$(command -v java)"
  fi
  exit 0
fi
if [[ "$#" -eq 0 ]]; then set -- mcp; fi
exec "$maestro_bin" "$@"
