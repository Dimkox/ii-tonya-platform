#!/usr/bin/env bash
set -uo pipefail
source_sha="${II_TONYA_SOURCE_SHA:?II_TONYA_SOURCE_SHA is required}"
workspace=/workspace/source
result_root="/workspace/results/$source_sha"
mkdir -p "$workspace" "$result_root" /workspace/.pnpm /workspace/.docker
if [[ ! -f "$workspace/.source-sha" ]] || [[ "$(cat "$workspace/.source-sha")" != "$source_sha" ]]; then
  find "$workspace" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  cp -a --no-preserve=ownership /seed/. "$workspace/"
fi
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
run_step frozen-install pnpm install --offline --frozen-lockfile --store-dir "$workspace/.pnpm-store"
run_step build pnpm build
run_step format pnpm format:check
run_step deploy-contract pnpm verify:deploy
run_step lint pnpm lint
run_step typecheck pnpm typecheck
run_step unit pnpm exec vitest run packages apps --maxWorkers=1
run_step property pnpm exec vitest run packages/domain/src/billing.property.test.ts packages/domain/src/expert-referral.property.test.ts --maxWorkers=1
run_step integration pnpm exec vitest run tests/integration tests/support tests/repo --maxWorkers=1
run_step contract pnpm exec vitest run tests/contract --maxWorkers=1
run_step security pnpm exec vitest run tests/repo/env-policy.test.ts tests/repo/scope-boundary.test.ts packages/application/src/prompt-safety.test.ts packages/observability/src/logger.test.ts apps/api/src/rate-limit.test.ts --maxWorkers=1
run_step e2e pnpm exec vitest run tests/e2e --maxWorkers=1
run_step audit proxychains4 -q -f "$proxy_config" pnpm audit --prod --audit-level high
run_step container pnpm test:container
printf 'finished_at=%s\nexit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$failed" >> "$result_root/environment.txt"
(cd "$result_root" && sha256sum ./*.log environment.txt summary.tsv > SHA256SUMS)
exit "$failed"
