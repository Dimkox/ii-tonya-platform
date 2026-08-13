#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(hostname -s)" == "claw" ]] || {
  printf 'Syft provisioning may run only on the Claw host.\n' >&2
  exit 2
}

syft_version="1.42.3"
archive_sha="0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509"
binary_sha="6c1eb5c6f15c177fa3dd727ee186c61a660a3939a4e1dc1bc4b3e00eafec098e"
tool_root="/home/pall/app-stack/tools/syft-$syft_version"
binary="$tool_root/syft"

verify_binary() {
  test -x "$binary"
  printf '%s  %s\n' "$binary_sha" "$binary" | sha256sum -c --status -
}

if ! verify_binary; then
  command -v gh >/dev/null 2>&1 || {
    printf 'The verified Claw gh transport is required to provision Syft.\n' >&2
    exit 1
  }
  temp_dir="$(mktemp -d)"
  cleanup() { rm -rf "$temp_dir"; }
  trap cleanup EXIT
  gh release download "v$syft_version" \
    --repo anchore/syft \
    --pattern "syft_${syft_version}_linux_amd64.tar.gz" \
    --dir "$temp_dir"
  archive="$temp_dir/syft_${syft_version}_linux_amd64.tar.gz"
  printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c --status -
  tar -xzf "$archive" -C "$temp_dir" syft
  printf '%s  %s\n' "$binary_sha" "$temp_dir/syft" | sha256sum -c --status -
  install -d -m 0755 "$tool_root"
  install -m 0755 "$temp_dir/syft" "$binary.tmp"
  mv -f "$binary.tmp" "$binary"
fi

verify_binary
printf '%s\n' "$binary"
