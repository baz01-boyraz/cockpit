#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: npm run app:refresh -- [--no-relaunch] [--skip-build] [--dry-run]

Builds the unsigned local macOS app, replaces the installed app bundle, and
relaunches it. This is the local development refresh path, not a remote
auto-updater.

Options:
  --no-relaunch  Install the app but do not open it afterward.
  --skip-build   Reuse the latest release/*.app bundle.
  --dry-run      Print the install actions without quitting or copying.

Environment:
  APP_NAME       Defaults to "cockpiT".
  APP_BUNDLE_ID  Defaults to "com.boyraz.cockpit".
  DEST_DIR       Defaults to "/Applications".
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="${APP_NAME:-cockpiT}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.boyraz.cockpit}"
DEST_DIR="${DEST_DIR:-/Applications}"
DEST_APP="${DEST_DIR%/}/${APP_NAME}.app"
RELAUNCH=1
SKIP_BUILD=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-relaunch)
      RELAUNCH=0
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[refresh] Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] npm run package:dir"
  else
    echo "[refresh] Building packaged app..."
    npm run package:dir
  fi
fi

BUILT_APP=""
for candidate in \
  "$ROOT_DIR/release/mac-arm64/${APP_NAME}.app" \
  "$ROOT_DIR/release/mac-universal/${APP_NAME}.app" \
  "$ROOT_DIR/release/mac/${APP_NAME}.app"
do
  if [[ -d "$candidate" ]]; then
    BUILT_APP="$candidate"
    break
  fi
done

if [[ -z "$BUILT_APP" ]]; then
  BUILT_APP="$(find "$ROOT_DIR/release" -maxdepth 3 -type d -name "${APP_NAME}.app" -print -quit 2>/dev/null || true)"
fi

if [[ -z "$BUILT_APP" || ! -d "$BUILT_APP" ]]; then
  echo "[refresh] Could not find built app bundle under release/." >&2
  echo "[refresh] Run npm run package:dir first, or remove --skip-build." >&2
  exit 66
fi

case "$DEST_APP" in
  /Applications/*.app|"$HOME"/Applications/*.app)
    ;;
  *)
    echo "[refresh] Refusing to replace app outside /Applications or ~/Applications: $DEST_APP" >&2
    exit 65
    ;;
esac

echo "[refresh] Built app: $BUILT_APP"
echo "[refresh] Target app: $DEST_APP"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would quit ${APP_NAME} if it is running"
  echo "[dry-run] would replace ${DEST_APP}"
  if [[ "$RELAUNCH" -eq 1 ]]; then
    echo "[dry-run] would open ${DEST_APP}"
  fi
  exit 0
fi

is_app_running() {
  pgrep -f "/${APP_NAME}.app/" >/dev/null 2>&1 || pgrep -x "$APP_NAME" >/dev/null 2>&1
}

if is_app_running; then
  echo "[refresh] Quitting running app..."
  osascript -e "tell application id \"${APP_BUNDLE_ID}\" to quit" >/dev/null 2>&1 \
    || osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 \
    || true

  for _ in {1..30}; do
    if ! is_app_running; then
      break
    fi
    sleep 0.5
  done

  if is_app_running; then
    echo "[refresh] ${APP_NAME} is still running. Quit it manually, then rerun npm run app:refresh." >&2
    exit 67
  fi
fi

echo "[refresh] Installing app bundle..."
mkdir -p "$DEST_DIR"
if [[ -d "$DEST_APP" ]]; then
  rm -rf "$DEST_APP"
fi
ditto "$BUILT_APP" "$DEST_APP"
xattr -dr com.apple.quarantine "$DEST_APP" >/dev/null 2>&1 || true

if [[ "$RELAUNCH" -eq 1 ]]; then
  echo "[refresh] Relaunching app..."
  open "$DEST_APP"
fi

echo "[refresh] Done."
