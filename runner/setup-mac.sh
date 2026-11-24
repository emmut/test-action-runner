#!/usr/bin/env bash
# Temporary native macOS runners (no VM): jobs run as your user, with access to your home dir.
#   runner/setup-mac.sh          # register + start RUNNER_COUNT runners in the background
#   runner/setup-mac.sh remove   # stop, deregister and delete them
set -euo pipefail
REPO=${REPO:-emmut/test-action-runner}
RUNNER_COUNT=${RUNNER_COUNT:-5}
ROOT=${ROOT:-$HOME/actions-runner-native}

if [ "${1:-}" = remove ]; then
  for dir in "$ROOT"/mac-native-*; do
    [ -d "$dir" ] || continue
    pkill -f "$dir/bin/Runner.Listener" || true
    token=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" -q .token)
    (cd "$dir" && ./config.sh remove --token "$token") || true
  done
  rm -rf "$ROOT"
  exit 0
fi

# The runner records PATH at config time; jobs need docker, jq and the host's bun.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for tool in docker jq bun; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }; done

VERSION=$(gh api repos/actions/runner/releases/latest -q .tag_name); VERSION=${VERSION#v}
mkdir -p "$ROOT"
tarball="$ROOT/runner-$VERSION.tar.gz"
[ -f "$tarball" ] || curl -fsSL -o "$tarball" \
  "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-osx-arm64-$VERSION.tar.gz"

for i in $(seq 1 "$RUNNER_COUNT"); do
  dir="$ROOT/mac-native-$i"
  if [ ! -f "$dir/.runner" ]; then
    mkdir -p "$dir" && tar xzf "$tarball" -C "$dir"
    token=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" -q .token)
    (cd "$dir" && ./config.sh --unattended --replace --url "https://github.com/$REPO" --token "$token" \
      --name "mac-native-$i" --labels native)
  fi
  pgrep -f "$dir/bin/Runner.Listener" >/dev/null || (cd "$dir" && nohup ./run.sh >"$dir/run.log" 2>&1 &)
done

sleep 10
gh api "repos/$REPO/actions/runners" -q '.runners[] | "\(.name)\t\(.status)\t\([.labels[].name] | join(","))"'
