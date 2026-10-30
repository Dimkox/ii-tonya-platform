#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
task_dir="$(mktemp -d)"
unit="ii-tonya-prepare-sandbox-$(date +%s)-$$"
run_dir="/run/$unit"
cleanup() {
  sudo -n systemctl stop "$unit.service" >/dev/null 2>&1 || true
  sudo -n systemctl stop "$unit-prepare.service" >/dev/null 2>&1 || true
  sudo -n systemctl reset-failed "$unit.service" "$unit-prepare.service" >/dev/null 2>&1 || true
  sudo -n rm -f "/run/systemd/system/$unit.service" || true
  sudo -n rm -f "/run/systemd/system/$unit-prepare.service" || true
  sudo -n systemctl daemon-reload >/dev/null 2>&1 || true
  sudo -n rm -rf -- "$run_dir" || true
  rm -rf -- "$task_dir"
}
trap cleanup EXIT
sudo -n install -d -m 0755 "$run_dir" "$run_dir/code" "$run_dir/release" "$run_dir/release/gateway" "$run_dir/release/gateway-provision"
sudo -n install -m 0644 "$repo/deploy/gateway-provision/prepare-native.mjs" "$run_dir/helper.mjs"
cat > "$task_dir/setup.mjs" <<'NODE'
import {writeFileSync,chownSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareNative} from './helper.mjs';
const base=process.argv[2], root=join(base,'release'), codeDir=join(base,'code'), source='a'.repeat(40), uid=65534;
const names=['gateway/launcher.py','gateway/bound_gateway.py','gateway/durable_state.py','gateway/gateway.py','gateway/ipc.py','gateway/nonce_registry.py','gateway/pg_authority.py','gateway/provider_reader.py','gateway/subject_tokens.py','gateway/readiness.sql','gateway-provision/prepare_gateway.py'];
const files={};for(const name of names){const b=`synthetic:${name}`;writeFileSync(join(root,name),b,{mode:0o640});chownSync(join(root,name),uid,uid);files[name]=createHash('sha256').update(b).digest('hex');}
for(const dir of [root,join(root,'gateway'),join(root,'gateway-provision')]){chownSync(dir,uid,uid);chmodSync(dir,0o750);}
for(const [name,text] of [['SOURCE_SHA',source],['provenance.json',JSON.stringify({format:'ii-tonya-native-v1',source_sha:source,source_archive_sha256:'b'.repeat(64)})]]){writeFileSync(join(root,name),text,{mode:0o640});chownSync(join(root,name),uid,uid);}
const sql='select 1;',sqlPath=join(base,'roles.sql'),configPath=join(base,'config.json'),manifestPath=join(base,'manifest.json');writeFileSync(sqlPath,sql,{mode:0o600});writeFileSync(configPath,JSON.stringify({database:'synthetic',sql_sha256:createHash('sha256').update(sql).digest('hex')}),{mode:0o600});writeFileSync(manifestPath,JSON.stringify({source_sha:source,files}),{mode:0o600});
const run=()=>({status:0,stdout:'loaded\ninactive\n0\n'});prepareNative({root,codeDir,sqlPath,configPath,manifestPath,ownerUid:0,publisherUid:uid,run});
NODE
cat > "$task_dir/select.mjs" <<'NODE'
import {selectCodeOnly} from './helper.mjs';
const base=process.argv[2]; selectCodeOnly({root:`${base}/release`,codeDir:`${base}/code`,ownerUid:0,publisherUid:65534});
NODE
cat > "$task_dir/read.mjs" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const dir=process.argv[2];if(!readFileSync(`${dir}/current/gateway/launcher.py`,'utf8').startsWith('synthetic:'))process.exit(2);
const status=readFileSync('/proc/self/status','utf8');
for(const key of ['CapPrm','CapEff','CapAmb'])if(!new RegExp(`^${key}:\\s*0+$`,'m').test(status))process.exit(5);
if(!/^NoNewPrivs:\s*1$/m.test(status))process.exit(6);
try {writeFileSync(`${dir}/current/gateway/launcher.py`,'modified');process.exit(3);} catch(e) {if(e.code!=='EACCES' && e.code!=='EROFS')process.exit(4);}
NODE
for f in setup select read; do sudo -n install -m 0644 "$task_dir/$f.mjs" "$run_dir/$f.mjs"; done
sudo -n /usr/bin/node --jitless "$run_dir/setup.mjs" "$run_dir" >/dev/null 2>&1
cat > "$task_dir/$unit.service" <<UNIT
[Unit]
Description=Isolated synthetic gateway selector proof
[Service]
Type=oneshot
TimeoutStartSec=20s
User=nobody
Group=nogroup
WorkingDirectory=$run_dir/code
ExecStartPre=+/usr/bin/node --jitless $run_dir/select.mjs $run_dir
ExecStart=/usr/bin/node --jitless $run_dir/read.mjs $run_dir/code
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077
UNIT
cat > "$task_dir/$unit-prepare.service" <<UNIT
[Unit]
Description=Isolated synthetic preparation credential drop proof
[Service]
Type=oneshot
TimeoutStartSec=20s
User=root
Group=root
WorkingDirectory=$run_dir/code
ExecStart=/usr/bin/timeout --kill-after=2s 10s /usr/sbin/runuser -u nobody -- /usr/bin/node --jitless $run_dir/read.mjs $run_dir/code
NoNewPrivileges=yes
AmbientCapabilities=CAP_SETUID CAP_SETGID
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
UMask=0077
UNIT
sudo -n install -m 0644 "$task_dir/$unit.service" "/run/systemd/system/$unit.service"
sudo -n install -m 0644 "$task_dir/$unit-prepare.service" "/run/systemd/system/$unit-prepare.service"
sudo -n systemctl daemon-reload
sudo -n timeout -k 2s 25s systemctl start "$unit.service"
test "$(sudo -n systemctl show "$unit.service" --property=Result --value)" = success
sudo -n timeout -k 2s 25s systemctl start "$unit-prepare.service"
test "$(sudo -n systemctl show "$unit-prepare.service" --property=Result --value)" = success
echo 'local systemd sandbox: root selector and runuser credential drop succeeded; unprivileged process could not modify code (DB and provider mocked)'
