#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: npm run app:install-release -- [--version vX.Y.Z] [--no-relaunch] [--dry-run]

Downloads a published GitHub release of cockpiT, installs it into /Applications,
strips the quarantine flag, and opens it. This is the one-time baseline install
for the free self-signed build: macOS Gatekeeper blocks the self-signed download
with "is damaged" until quarantine is removed. After this baseline is installed,
every later version updates silently in-app (electron-updater), so you only need
to run this once.

Options:
  --version vX.Y.Z  Install a specific tag. Defaults to the latest release.
  --no-relaunch     Install but do not open afterward.
  --dry-run         Print the actions without downloading or installing.

Environment:
  RELEASE_REPO   Defaults to "baz01-boyraz/cockpit".
  APP_NAME       Defaults to "cockpiT".
  APP_BUNDLE_ID  Defaults to "com.boyraz.cockpit".
  DEST_DIR       Defaults to "/Applications".
EOF
}

RELEASE_REPO="${RELEASE_REPO:-baz01-boyraz/cockpit}"
APP_NAME="${APP_NAME:-cockpiT}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.boyraz.cockpit}"
DEST_DIR="${DEST_DIR:-/Applications}"
DEST_APP="${DEST_DIR%/}/${APP_NAME}.app"
VERSION=""
RELAUNCH=1
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift
      ;;
    --no-relaunch)
      RELAUNCH=0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[install-release] Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

case "$DEST_APP" in
  /Applications/*.app|"$HOME"/Applications/*.app)
    ;;
  *)
    echo "[install-release] Refusing to install outside /Applications or ~/Applications: $DEST_APP" >&2
    exit 65
    ;;
esac

# A real install must originate from Cockpit's current confirmation dialog.
# Consume the short-lived capability before any download or lifecycle action.
if [[ "$DRY_RUN" -eq 0 ]]; then
  node scripts/release/consume-lifecycle-approval.mjs app_install_release
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[install-release] gh CLI not found. Install it or download the release manually." >&2
  exit 69
fi

TARGET_DESC="${VERSION:-latest}"
echo "[install-release] Repo: $RELEASE_REPO"
echo "[install-release] Release: $TARGET_DESC"
echo "[install-release] Target: $DEST_APP"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would download ${APP_NAME} ${TARGET_DESC} (arm64 zip) from $RELEASE_REPO"
  echo "[dry-run] would quit ${APP_NAME} if running, replace ${DEST_APP}, strip quarantine"
  [[ "$RELAUNCH" -eq 1 ]] && echo "[dry-run] would open ${DEST_APP}"
  exit 0
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cockpit-release.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[install-release] Downloading..."
DL_ARGS=(release download --repo "$RELEASE_REPO" --pattern "*arm64-mac.zip" --dir "$TMP_DIR" --clobber)
[[ -n "$VERSION" ]] && DL_ARGS+=("$VERSION")
gh "${DL_ARGS[@]}"

ZIP_FILE="$(find "$TMP_DIR" -maxdepth 1 -name '*arm64-mac.zip' -print -quit)"
if [[ -z "$ZIP_FILE" ]]; then
  echo "[install-release] No arm64 zip asset found for $TARGET_DESC." >&2
  exit 66
fi

echo "[install-release] Extracting $(basename "$ZIP_FILE")..."
ditto -x -k "$ZIP_FILE" "$TMP_DIR/app"
SRC_APP="$(find "$TMP_DIR/app" -maxdepth 2 -type d -name "${APP_NAME}.app" -print -quit)"
if [[ -z "$SRC_APP" || ! -d "$SRC_APP" ]]; then
  echo "[install-release] Could not find ${APP_NAME}.app inside the downloaded zip." >&2
  exit 66
fi

is_app_running() {
  pgrep -f "/${APP_NAME}.app/" >/dev/null 2>&1 || pgrep -x "$APP_NAME" >/dev/null 2>&1
}

if is_app_running; then
  echo "[install-release] Quitting running app..."
  osascript -e "tell application id \"${APP_BUNDLE_ID}\" to quit" >/dev/null 2>&1 \
    || osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 \
    || true
  for _ in {1..30}; do
    is_app_running || break
    sleep 0.5
  done
  if is_app_running; then
    echo "[install-release] ${APP_NAME} is still running. Quit it manually, then rerun." >&2
    exit 67
  fi
fi

echo "[install-release] Installing app bundle..."
mkdir -p "$DEST_DIR"
[[ -d "$DEST_APP" ]] && rm -rf "$DEST_APP"
ditto "$SRC_APP" "$DEST_APP"
# Strip quarantine so the self-signed (un-notarized) app opens without "is damaged".
xattr -cr "$DEST_APP" >/dev/null 2>&1 || true

if [[ "$RELAUNCH" -eq 1 ]]; then
  echo "[install-release] Opening app..."
  open "$DEST_APP"
fi

echo "[install-release] Done. From here, future versions update in-app automatically."
