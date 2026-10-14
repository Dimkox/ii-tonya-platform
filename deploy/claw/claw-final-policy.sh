#!/usr/bin/env bash
set -euo pipefail
cd /workspace/source
export CI=true
proxy_ip="$(getent ahostsv4 proxy-gateway | awk 'NR == 1 { print $1 }')"
printf '%s\n' strict_chain proxy_dns 'tcp_read_time_out 15000' \
  'tcp_connect_time_out 8000' '[ProxyList]' "socks5 $proxy_ip 1080" > /workspace/.proxychains4.conf
proxychains4 -q -f /workspace/.proxychains4.conf pnpm install --frozen-lockfile --store-dir /workspace/source/.pnpm-store
pnpm test:repeat -- 3 \
  tests/repo/repeat-vitest.test.ts \
  tests/repo/workflow-semantics.test.ts \
  tests/repo/expert-residency-release-readiness.test.ts \
  tests/repo/scope-boundary.test.ts \
  --maxWorkers=1
