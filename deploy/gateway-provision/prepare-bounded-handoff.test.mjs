import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareNative } from "./prepare-native.mjs";
test("both privileged helpers run under a fixed process-group deadline and SQL is only on stdin", () => {
  const dir = mkdtempSync(join(tmpdir(), "bounded-prepare-")),
    release = join(dir, "release");
  try {
    mkdirSync(release, { mode: 0o700 });
    mkdirSync(join(release, "gateway"), { mode: 0o700 });
    mkdirSync(join(release, "gateway-provision"), { mode: 0o700 });
    for (const name of [
      "launcher.py",
      "bound_gateway.py",
      "durable_state.py",
      "gateway.py",
      "ipc.py",
      "nonce_registry.py",
      "pg_authority.py",
      "provider_reader.py",
      "subject_tokens.py",
      "readiness.sql",
    ])
      writeFileSync(join(release, "gateway", name), "x", { mode: 0o600 });
    writeFileSync(join(release, "gateway-provision/prepare_gateway.py"), "x", {
      mode: 0o600,
    });
    writeFileSync(join(release, "SOURCE_SHA"), "a".repeat(40), { mode: 0o600 });
    writeFileSync(
      join(release, "provenance.json"),
      JSON.stringify({
        format: "ii-tonya-native-v1",
        source_sha: "a".repeat(40),
        source_archive_sha256: "b".repeat(64),
      }),
      { mode: 0o600 },
    );
    const sql = "select 7;\n",
      sqlPath = join(dir, "roles"),
      configPath = join(dir, "config");
    writeFileSync(sqlPath, sql, { mode: 0o600 });
    writeFileSync(
      configPath,
      JSON.stringify({
        database: "tonya",
        sql_sha256: createHash("sha256").update(sql).digest("hex"),
      }),
      { mode: 0o600 },
    );
    const codeDir = join(dir, "code"),
      manifestPath = join(dir, "manifest");
    mkdirSync(codeDir, { mode: 0o755 });
    const names = [
      "gateway/launcher.py",
      "gateway/bound_gateway.py",
      "gateway/durable_state.py",
      "gateway/gateway.py",
      "gateway/ipc.py",
      "gateway/nonce_registry.py",
      "gateway/pg_authority.py",
      "gateway/provider_reader.py",
      "gateway/subject_tokens.py",
      "gateway/readiness.sql",
      "gateway-provision/prepare_gateway.py",
    ];
    const files = Object.fromEntries(
      names.map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(join(release, name)))
          .digest("hex"),
      ]),
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({ source_sha: "a".repeat(40), files }),
      { mode: 0o600 },
    );
    const calls = [];
    const run = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "loaded\ninactive\n0\n" };
    };
    assert.equal(
      prepareNative({
        root: release,
        configPath,
        sqlPath,
        manifestPath,
        codeDir,
        ownerUid: process.getuid(),
        publisherUid: process.getuid(),
        run,
      }),
      "prepared",
    );
    assert.equal(calls.length, 3);
    for (const call of calls.slice(1)) {
      assert.equal(call.command, "/usr/bin/timeout");
      assert.deepEqual(call.args.slice(0, 3), [
        "--kill-after=2s",
        "38s",
        "/usr/sbin/runuser",
      ]);
      assert.equal(call.options.timeout, 42000);
    }
    assert.ok(calls[1].args.includes("--file=-"));
    assert.equal(calls[1].options.input.toString(), sql);
    assert.ok(!calls[1].args.join(" ").includes(sql.trim()));
    assert.ok(calls[2].args.includes("ii_tonya_gateway"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
