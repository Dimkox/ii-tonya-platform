#!/usr/bin/env bash
set -uo pipefail
source_sha="${II_TONYA_TEST_SOURCE_SHA:?II_TONYA_TEST_SOURCE_SHA is required}"
workspace=/workspace/source
result_root="/workspace/results/${source_sha}-three-pass"
mkdir -p "$result_root" /workspace/.pnpm /workspace/.docker
cd "$workspace"
export CI=true PNPM_HOME=/workspace/.pnpm DOCKER_CONFIG=/workspace/.docker PATH="/workspace/.pnpm:$PATH"
proxy_ip="$(getent ahostsv4 proxy-gateway | awk 'NR == 1 { print $1 }')"
[[ -n "$proxy_ip" ]] || { printf 'proxy-gateway did not resolve\n' >&2; exit 2; }
proxy_config=/workspace/.proxychains4.conf
printf '%s\n' strict_chain proxy_dns 'tcp_read_time_out 15000' \
  'tcp_connect_time_out 8000' '[ProxyList]' "socks5 $proxy_ip 1080" > "$proxy_config"
summary="$result_root/summary.tsv"
: > "$summary"
failed=0
run_step() {
  local name="$1"; shift
  local log="$result_root/$name.log" started finished status
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@" > >(tee "$log") 2>&1; status=$?
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$started" "$finished" >> "$summary"
  [[ "$status" -eq 0 ]] || failed=1
  return 0
}
{
  printf 'source_sha=%s\nnode=%s\npnpm=%s\ndocker=%s\n' "$source_sha" "$(node --version)" "$(pnpm --version)" "$(docker --version)"
  printf 'memory_max=%s\ncpu_max=%s\npids_max=%s\n' "$(cat /sys/fs/cgroup/memory.max)" "$(cat /sys/fs/cgroup/cpu.max)" "$(cat /sys/fs/cgroup/pids.max)"
  df -B1 /workspace
} > "$result_root/environment.txt"
run_step frozen-install proxychains4 -q -f "$proxy_config" pnpm install --frozen-lockfile --store-dir "$workspace/.pnpm-store"
run_step build pnpm build
run_step format pnpm format:check
run_step deploy-contract pnpm verify:deploy
run_step lint pnpm lint
run_step typecheck pnpm typecheck
run_step vitest-1 pnpm exec vitest run --maxWorkers=1
run_step vitest-2 pnpm exec vitest run --maxWorkers=1
run_step vitest-3 pnpm exec vitest run --maxWorkers=1
run_step audit proxychains4 -q -f "$proxy_config" pnpm audit --prod --audit-level high
printf 'finished_at=%s\nexit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$failed" >> "$result_root/environment.txt"
(cd "$result_root" && sha256sum ./*.log environment.txt summary.tsv > SHA256SUMS)
exit "$failed"
