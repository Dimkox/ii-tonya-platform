import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const unit = readFileSync(
  new URL("../systemd/ii-tonya-early-bird-prepare.service", import.meta.url),
  "utf8",
);
const hook = readFileSync(
  new URL(
    "../systemd/ii-tonya-migrate.service.d/30-early-bird-prepare.conf",
    import.meta.url,
  ),
  "utf8",
);
const gateway = readFileSync(
  new URL("../systemd/ii-tonya-yookassa-gateway.service", import.meta.url),
  "utf8",
);
test("preparation runs as bounded separate root oneshot after migration without dependency cycle", () => {
  assert.match(unit, /^Type=oneshot$/mu);
  assert.match(unit, /^TimeoutStartSec=90s$/mu);
  assert.match(unit, /^User=root$/mu);
  assert.match(unit, /^NoNewPrivileges=yes$/mu);
  assert.match(unit, /^AmbientCapabilities=CAP_SETUID CAP_SETGID$/mu);
  assert.doesNotMatch(unit, /^(?:After|Requires|Wants)=.*ii-tonya-migrate/mu);
  assert.match(unit, /^Before=ii-tonya-yookassa-gateway\.service$/mu);
  assert.match(
    gateway,
    /^WorkingDirectory=\/var\/lib\/ii-tonya-yookassa-code$/mu,
  );
  assert.match(
    gateway,
    /^ExecStartPre=\+\/usr\/bin\/node --jitless \/usr\/local\/lib\/ii-tonya\/prepare-native\.mjs --select-code-only$/mu,
  );
  assert.match(
    unit,
    /^ExecStart=\/usr\/bin\/node --jitless \/usr\/local\/lib\/ii-tonya\/prepare-native\.mjs$/mu,
  );
  assert.match(
    hook,
    /^ExecStartPost=\+\/usr\/bin\/systemctl start ii-tonya-early-bird-prepare\.service$/mu,
  );
});
