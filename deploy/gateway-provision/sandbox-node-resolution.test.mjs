import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const script = readFileSync(
  new URL("./test_prepare_systemd_sandbox.sh", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/getzilla-verify.yml", import.meta.url),
  "utf8",
);
const template = readFileSync(
  new URL(
    "../../.getzilla/templates/ci/github-actions-verify.yml",
    import.meta.url,
  ),
  "utf8",
);
test("CI passes setup-node's absolute executable and sandbox validates Node 24 before root execution", () => {
  assert.match(
    workflow,
    /sudo -n bash deploy\/gateway-provision\/test_prepare_systemd_sandbox\.sh "\$\(command -v node\)"/u,
  );
  assert.match(
    template,
    /sudo -n bash deploy\/gateway-provision\/test_prepare_systemd_sandbox\.sh "\$\(command -v node\)"/u,
  );
  assert.match(script, /node_bin="\$\{1:-\$\(command -v node\)\}"/u);
  assert.match(script, /realpath -e -- "\$node_bin"/u);
  assert.match(
    script,
    /runuser -u nobody -- \/usr\/bin\/test -x "\$node_bin"/u,
  );
  assert.match(script, /synthetic systemd sandbox failed at stage: %s/u);
  assert.doesNotMatch(script, /ExecStartPre=\+\/usr\/bin\/node/u);
});
