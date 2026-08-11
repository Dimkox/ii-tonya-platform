#!/usr/bin/env bash
set -Eeuo pipefail

REPO="Dimkox/ii-tonya-platform"
RUNNER_USER="tonya"
RUNNER_DIR="/opt/actions-runner"
RUNNER_LABEL="ii-tonya-server"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this bootstrap as root" >&2
  exit 1
fi

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required" >&2
  exit 1
}

gh auth status >/dev/null

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl sudo tar

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$RUNNER_USER"
fi

install -d -m 0755 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
printf '%s\n' "$RUNNER_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ii-tonya-runner-bootstrap
chmod 0440 /etc/sudoers.d/ii-tonya-runner-bootstrap
visudo -cf /etc/sudoers.d/ii-tonya-runner-bootstrap >/dev/null

case "$(uname -m)" in
  x86_64) RUNNER_ARCH="x64" ;;
  aarch64|arm64) RUNNER_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

RUNNER_TAG="$(gh api repos/actions/runner/releases/latest --jq '.tag_name')"
RUNNER_VERSION="${RUNNER_TAG#v}"
RUNNER_TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/${RUNNER_TAG}/${RUNNER_TARBALL}"

if [[ ! -f "$RUNNER_DIR/.runner" ]]; then
  rm -rf "$RUNNER_DIR"/*
  sudo -u "$RUNNER_USER" curl -fL "$RUNNER_URL" -o "$RUNNER_DIR/$RUNNER_TARBALL"
  sudo -u "$RUNNER_USER" tar -xzf "$RUNNER_DIR/$RUNNER_TARBALL" -C "$RUNNER_DIR"
  rm -f "$RUNNER_DIR/$RUNNER_TARBALL"

  REGISTRATION_TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq '.token')"
  sudo -u "$RUNNER_USER" "$RUNNER_DIR/config.sh" \
    --url "https://github.com/$REPO" \
    --token "$REGISTRATION_TOKEN" \
    --name "ii-tonya-$(hostname)" \
    --labels "$RUNNER_LABEL" \
    --work _work \
    --unattended \
    --replace
fi

cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER" >/dev/null 2>&1 || true
./svc.sh start
./svc.sh status

echo "Runner is registered. The queued native deployment workflow can now provision and deploy the host."
