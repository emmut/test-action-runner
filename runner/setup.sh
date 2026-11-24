#!/usr/bin/env bash
# Create a Lima Linux VM and register self-hosted GitHub Actions runner(s) in it.
# Idempotent: re-run to start the VM or add runners (raise RUNNER_COUNT).
set -euo pipefail

REPO=${REPO:-emmut/test-action-runner}
VM=${VM:-gh-runner}
CPUS=${CPUS:-8}
MEMORY=${MEMORY:-8}   # GiB; host has 16, leave room so macOS doesn't swap
DISK=${DISK:-20}      # GiB; sparse, but stress jobs can fill it
RUNNER_COUNT=${RUNNER_COUNT:-1}
LABEL=${LABEL:-lima}

if ! limactl list -q | grep -qx "$VM"; then
  # --mount-none: don't expose the macOS home dir (~/.ssh etc.) to CI jobs
  limactl create --tty=false --name="$VM" --vm-type=vz \
    --cpus="$CPUS" --memory="$MEMORY" --disk="$DISK" --mount-none template:ubuntu-lts
fi
[ "$(limactl list "$VM" --format '{{.Status}}')" = Running ] || limactl start "$VM"

limactl shell "$VM" bash -s <<'EOF'
set -euo pipefail
sudo DEBIAN_FRONTEND=noninteractive apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq \
  stress-ng sysbench fio jq curl git build-essential docker.io unzip zip
sudo usermod -aG docker "$(whoami)"
EOF

VERSION=$(gh api repos/actions/runner/releases/latest -q .tag_name)
VERSION=${VERSION#v}

for i in $(seq 1 "$RUNNER_COUNT"); do
  # Registration token is short-lived; fetched per runner, never stored.
  TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" -q .token)
  limactl shell "$VM" bash -s -- "$VERSION" "$TOKEN" "$i" "$REPO" "$VM" "$LABEL" <<'EOF'
set -euo pipefail
version=$1 token=$2 i=$3 repo=$4 vm=$5 label=$6
dir=~/runner-$i
if [ -f "$dir/.runner" ]; then echo "runner-$i already configured"; exit 0; fi
mkdir -p "$dir" && cd "$dir"
curl -fsSL "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-arm64-$version.tar.gz" | tar xz
sudo ./bin/installdependencies.sh >/dev/null
./config.sh --unattended --replace --url "https://github.com/$repo" --token "$token" \
  --name "$vm-$i" --labels "$label"
sudo ./svc.sh install "$(whoami)"
sudo ./svc.sh start
EOF
done

# An OOM-killed runner otherwise stays offline until restarted by hand.
limactl shell "$VM" bash -s <<'EOF'
for unit in /etc/systemd/system/actions.runner.*.service; do
  sudo mkdir -p "$unit.d"
  printf '[Service]\nRestart=always\nRestartSec=5\n' | sudo tee "$unit.d/restart.conf" >/dev/null
done
sudo systemctl daemon-reload
EOF

gh api "repos/$REPO/actions/runners" -q '.runners[] | "\(.name)\t\(.status)\t\([.labels[].name] | join(","))"'
