#!/usr/bin/env node
// SCRUM-503 slice 1: read-only classification of Git-binary artifacts.
// Never deletes, rewrites or decompresses to disk; evidence stays untouched.
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const IMAGE = /\.(png|jpe?g|webp|avif|gif)$/i;
const ENGINE_ARCHIVE = ".getzilla/getzilla.zip";
const EVIDENCE_GZ = /^docs\/test-evidence\/.+\.gz$/;
const MAX_GZ_BYTES = 8 * 1_048_576;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
// Exact reviewed exceptions: path plus Git blob id. A changed blob is unclassified again.
// labelled.docx.gz is listed in residency-rich-onboarding-2026-10-27/manifest.json.
export const REVIEWED_DOCUMENT_FIXTURES = new Map([
  [
    "docs/test-evidence/residency-rich-onboarding-2026-10-27/labelled.docx.gz",
    "fcaf75183557811abff7f10f71e2f89d6f8e0fda",
  ],
]);

const git = (root, args, encoding = "utf8") =>
  execFileSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 256 * 1_048_576,
  });

function isUtf8Text(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function classifyEntry({ path, mode, oid, readBlob }) {
  if (mode !== "100644") return { class: "unclassified", reason: "mode" };
  if (REVIEWED_DOCUMENT_FIXTURES.get(path) === oid) {
    return { class: "reviewed-document-fixture" };
  }
  if (path === ENGINE_ARCHIVE) return { class: "vendored-engine-archive" };
  if (IMAGE.test(path)) return { class: "inert-image" };
  if (EVIDENCE_GZ.test(path)) {
    try {
      const text = gunzipSync(readBlob(), { maxOutputLength: MAX_GZ_BYTES });
      if (isUtf8Text(text)) return { class: "compressed-text-evidence" };
      if (
        text.subarray(0, 8).equals(PNG_MAGIC) ||
        text.subarray(0, 3).equals(JPEG_MAGIC)
      ) {
        return { class: "compressed-inert-image" };
      }
      return { class: "unclassified", reason: "gzip-not-text" };
    } catch {
      return { class: "unclassified", reason: "gzip-unreadable" };
    }
  }
  return { class: "unclassified", reason: "unknown-type" };
}

export function classifyRepository(root, ref = "HEAD") {
  const numstat = git(root, [
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    "--no-textconv",
    "--no-ext-diff",
    EMPTY_TREE,
    ref,
    "--",
  ]);
  const binaries = numstat
    .split("\0")
    .filter(Boolean)
    .map((row) => row.split("\t"))
    .filter(([a, r]) => a === "-" && r === "-")
    .map(([, , path]) => path);
  const tree = new Map();
  for (const row of git(root, ["ls-tree", "-r", "-z", ref]).split("\0")) {
    if (!row) continue;
    const [meta, path] = row.split("\t");
    const [mode, , oid] = meta.split(" ");
    tree.set(path, { mode, oid });
  }
  const entries = binaries.sort().map((path) => {
    const { mode, oid } = tree.get(path) ?? {};
    const result = classifyEntry({
      path,
      mode,
      oid,
      readBlob: () => git(root, ["cat-file", "blob", oid], "buffer"),
    });
    return { path, oid, ...result };
  });
  const counts = {};
  for (const entry of entries)
    counts[entry.class] = (counts[entry.class] ?? 0) + 1;
  return {
    ref: git(root, ["rev-parse", ref]).trim(),
    total: entries.length,
    counts,
    entries,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const report = classifyRepository(process.cwd());
  const unclassified = report.entries.filter((e) => e.class === "unclassified");
  const output = process.argv.includes("--full")
    ? report
    : {
        ref: report.ref,
        total: report.total,
        counts: report.counts,
        unclassified,
      };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (check && unclassified.length > 0) process.exitCode = 1;
}
