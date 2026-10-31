import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSource, hashFile } from "./archive-hash.mjs";

test("streams the actual source archive and matches sha256sum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-archive-test-"));
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const file = join(dir, "source.tar");
    archiveSource(sha, file);
    assert.ok((await stat(file)).size > 100 * 1024 * 1024);
    const expected = execFileSync("sha256sum", [file], {
      encoding: "utf8",
    }).split(" ")[0];
    assert.equal(await hashFile(file), expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
