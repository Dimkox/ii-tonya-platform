import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readlinkSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectCodeOnly } from "./prepare-native.mjs";
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
test("rollback selects only previously published, intact source and never calls a child process", () => {
  const dir = mkdtempSync(join(tmpdir(), "selector-")),
    root = join(dir, "release"),
    codeDir = join(dir, "code"),
    source = "a".repeat(40),
    target = join(codeDir, source);
  try {
    mkdirSync(root, { mode: 0o755 });
    mkdirSync(codeDir, { mode: 0o755 });
    mkdirSync(target, { mode: 0o755 });
    mkdirSync(join(target, "gateway"), { mode: 0o755 });
    mkdirSync(join(target, "gateway-provision"), { mode: 0o755 });
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
    const files = {};
    for (const name of names) {
      const content = `data:${name}`;
      writeFileSync(join(target, name), content, { mode: 0o644 });
      files[name] = createHash("sha256").update(content).digest("hex");
    }
    writeFileSync(
      join(target, "manifest.json"),
      JSON.stringify({ source_sha: source, files }),
      { mode: 0o644 },
    );
    symlinkSync("previous", join(codeDir, "current"));
    const options = {
      root,
      codeDir,
      ownerUid: process.getuid(),
      publisherUid: process.getuid(),
    };
    selectCodeOnly(options);
    assert.equal(readlinkSync(join(codeDir, "current")), source);
    writeFileSync(join(target, "gateway/launcher.py"), "tampered");
    assert.throws(() => selectCodeOnly(options));
    assert.equal(readlinkSync(join(codeDir, "current")), source);
    writeFileSync(join(root, "SOURCE_SHA"), "c".repeat(40));
    assert.throws(() => selectCodeOnly(options));
    assert.equal(readlinkSync(join(codeDir, "current")), source);
    writeFileSync(
      join(root, "provenance.json"),
      JSON.stringify({
        format: "ii-tonya-native-v1",
        source_sha: "c".repeat(40),
        source_archive_sha256: "b".repeat(64),
      }),
    );
    assert.throws(() => selectCodeOnly(options));
    assert.equal(readlinkSync(join(codeDir, "current")), source);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
