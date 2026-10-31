#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
image='python@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704'
test_dir="$(mktemp -d)"
chmod 0777 "$test_dir"
cleanup() {
  docker run --rm --network none --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add FOWNER --mount "type=bind,src=$test_dir,dst=/fixture" "$image" python -B -c 'import shutil; shutil.rmtree("/fixture/state", ignore_errors=True)' >/dev/null 2>&1 || true
  rmdir "$test_dir" 2>/dev/null || true
}
trap cleanup EXIT
docker run --rm --network none --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --mount "type=bind,src=$test_dir,dst=/fixture" "$image" python -B -c 'import os; os.mkdir("/fixture/state",0o700); os.chown("/fixture/state",10001,10001); p="/fixture/state/.initial-state-authorized"; f=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.close(f)'
docker run --rm --network none --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,src=$test_dir/state,dst=/state" --mount "type=bind,src=$root_dir/deploy/gateway-provision/prepare_gateway.py,dst=/release/gateway-provision/prepare_gateway.py,readonly" --mount "type=bind,src=$root_dir/scripts/experimental/yookassa_gateway,dst=/release/gateway,readonly" "$image" python -B -c 'import importlib.util,os; s=importlib.util.spec_from_file_location("prepare","/release/gateway-provision/prepare_gateway.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.read_secret=lambda p: bytes([1 if p=="auth" else 2])*32; m.initialize_state=lambda c: None; m.initialize_nonce_registry=lambda c: None; m.prepare({"state_dir":"/state","nonce_file":"/state/nonce","auth_key_file":"auth","subject_key_file":"subject"}); assert not os.path.exists("/state/.initial-state-authorized")'
echo 'cross-UID root-owned marker handoff passed (state and DB mocked)'
