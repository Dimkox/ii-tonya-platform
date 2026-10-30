import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareNative } from "./prepare-native.mjs";
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
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "code-publication-")),
    root = join(dir, "release"),
    codeDir = join(dir, "code"),
    configPath = join(dir, "config"),
    sqlPath = join(dir, "sql"),
    manifestPath = join(dir, "manifest"),
    source = "a".repeat(40),
    sql = "select 1;";
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(codeDir, { mode: 0o755 });
  mkdirSync(join(root, "gateway"), { mode: 0o700 });
  mkdirSync(join(root, "gateway-provision"), { mode: 0o700 });
  const files = {};
  for (const name of names) {
    const bytes = `synthetic:${name}`;
    writeFileSync(join(root, name), bytes, { mode: 0o600 });
    files[name] = createHash("sha256").update(bytes).digest("hex");
  }
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
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  writeFileSync(
    configPath,
    JSON.stringify({
      database: "tonya",
      sql_sha256: createHash("sha256").update(sql).digest("hex"),
    }),
    { mode: 0o600 },
  );
  writeFileSync(manifestPath, JSON.stringify({ source_sha: source, files }), {
    mode: 0o600,
  });
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0, stdout: "loaded\ninactive\n0\n" };
  };
  return {
    dir,
    root,
    codeDir,
    configPath,
    sqlPath,
    manifestPath,
    source,
    calls,
    options: {
      root,
      codeDir,
      configPath,
      sqlPath,
      manifestPath,
      ownerUid: process.getuid(),
      publisherUid: process.getuid(),
      run,
    },
  };
}
test("publishes only reviewed bytes readable by the isolated gateway even with restrictive umask", () => {
  const f = setup(),
    prior = process.umask(0o077);
  try {
    assert.equal(prepareNative(f.options), "prepared");
    assert.equal(readlinkSync(join(f.codeDir, "current")), f.source);
    for (const name of names) {
      const path = join(f.codeDir, f.source, name);
      assert.equal(statSync(path).mode & 0o777, 0o644);
      assert.equal(readFileSync(path, "utf8"), `synthetic:${name}`);
    }
    assert.equal(statSync(join(f.codeDir, f.source)).mode & 0o777, 0o755);
    assert.equal(f.calls.length, 3);
  } finally {
    process.umask(prior);
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("failed gateway initialization preserves the previous selected code", () => {
  const f = setup();
  try {
    symlinkSync("previous", join(f.codeDir, "current"));
    let count = 0;
    const run = () =>
      ++count === 3
        ? { status: 1 }
        : { status: 0, stdout: "loaded\ninactive\n0\n" };
    assert.throws(() => prepareNative({ ...f.options, run }));
    assert.equal(readlinkSync(join(f.codeDir, "current")), "previous");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("changed source or wrong owner prevents all child processes", () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "gateway/launcher.py"), "tampered");
    assert.throws(() => prepareNative(f.options));
    assert.equal(f.calls.length, 0);
    assert.throws(() =>
      prepareNative({ ...f.options, ownerUid: process.getuid() + 1 }),
    );
    assert.equal(f.calls.length, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
