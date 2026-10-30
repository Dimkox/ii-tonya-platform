import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareNative } from "./prepare-native.mjs";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "gateway-prepare-")),
    root = join(dir, "release");
  mkdirSync(root, { mode: 0o750 });
  const source = "a".repeat(40),
    sql = "SELECT 1;\n",
    sqlPath = join(dir, "roles.sql"),
    configPath = join(dir, "prepare.json");
  writeFileSync(join(root, "SOURCE_SHA"), source, { mode: 0o600 });
  writeFileSync(
    join(root, "provenance.json"),
    JSON.stringify({
      format: "ii-tonya-native-v1",
      source_sha: source,
      source_archive_sha256: "b".repeat(64),
    }),
    { mode: 0o600 },
  );
  mkdirSync(join(root, "gateway"), { mode: 0o750 });
  mkdirSync(join(root, "gateway-provision"), { mode: 0o750 });
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
    writeFileSync(join(root, "gateway", name), "fixture", { mode: 0o600 });
  writeFileSync(
    join(root, "gateway-provision", "prepare_gateway.py"),
    "fixture",
    { mode: 0o600 },
  );
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
        .update(readFileSync(join(root, name)))
        .digest("hex"),
    ]),
  );
  writeFileSync(manifestPath, JSON.stringify({ source_sha: source, files }), {
    mode: 0o600,
  });
  const calls = [];
  const run = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0, stdout: "loaded\ninactive\n0\n" };
  };
  return {
    dir,
    root,
    sqlPath,
    configPath,
    calls,
    options: {
      root,
      sqlPath,
      configPath,
      manifestPath,
      codeDir,
      ownerUid: process.getuid(),
      publisherUid: process.getuid(),
      run,
    },
  };
}
test("validated preparation sends SQL through stdin to fixed commands", () => {
  const f = fixture();
  try {
    assert.equal(prepareNative(f.options), "prepared");
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[1].cmd, "/usr/bin/timeout");
    assert.deepEqual(f.calls[1].args.slice(0, 3), [
      "--kill-after=2s",
      "38s",
      "/usr/sbin/runuser",
    ]);
    assert.ok(f.calls[1].args.includes("--file=-"));
    assert.equal(f.calls[1].options.input.toString(), "SELECT 1;\n");
    assert.equal(f.calls[2].args[4], "ii_tonya_gateway");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("unsafe files or hash prevent any process invocation", () => {
  for (const mutation of ["mode", "hash", "symlink", "duplicate"]) {
    const f = fixture();
    try {
      if (mutation === "mode") chmodSync(f.configPath, 0o644);
      if (mutation === "hash") writeFileSync(f.sqlPath, "changed");
      if (mutation === "duplicate")
        writeFileSync(
          f.configPath,
          `{ "database":"one", "database":"two", "sql_sha256":"${"a".repeat(64)}" }`,
        );
      if (mutation === "symlink") {
        rmSync(f.configPath);
        symlinkSync(f.sqlPath, f.configPath);
      }
      assert.throws(() => prepareNative(f.options));
      assert.equal(f.calls.length, 0);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});
test("missing operator config skips without running commands", () => {
  const f = fixture();
  try {
    rmSync(f.configPath);
    assert.equal(prepareNative(f.options), "skipped");
    assert.equal(f.calls.length, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("bridge provenance skips preparation and active gateway never invokes SQL", () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.root, "provenance.json"),
      JSON.stringify({
        format: "ii-tonya-native-v1",
        source_sha: "a".repeat(40),
        source_archive_sha256: "b".repeat(64),
        profile: "early-bird-compatibility-bridge-v1",
        runtime_source_sha: "c".repeat(40),
      }),
    );
    assert.equal(prepareNative(f.options), "skipped");
    assert.equal(f.calls.length, 0);
    writeFileSync(
      join(f.root, "provenance.json"),
      JSON.stringify({
        format: "ii-tonya-native-v1",
        source_sha: "a".repeat(40),
        source_archive_sha256: "b".repeat(64),
      }),
    );
    assert.throws(() =>
      prepareNative({
        ...f.options,
        run: (cmd, args, options) => {
          f.calls.push({ cmd, args, options });
          return { status: 0, stdout: "loaded\nactive\n123\n" };
        },
      }),
    );
    assert.equal(f.calls.length, 1);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
