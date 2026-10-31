import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Historical 0000..0081 witness only. Never changes the canonical journal. */
export async function buildEarlyBirdMigrationCandidate({
  root,
  output,
  observeCurrentSources = false,
}) {
  root = path.resolve(root);
  output = await realpath(output);
  if (
    output === root ||
    output.startsWith(path.join(root, "packages", "db", "migrations"))
  )
    throw new Error("candidate_output_must_be_disposable");
  if ((await readdir(output)).length !== 0)
    throw new Error("candidate_output_must_be_empty");
  const manifest = JSON.parse(
    await readFile(
      path.join(
        root,
        "docs/superpowers/implementation-artifacts/early-bird-0081-promotion-segments-2026-10-30.json",
      ),
      "utf8",
    ),
  );
  const folder = path.join(root, "packages/db/migrations");
  const journal = JSON.parse(
    await readFile(path.join(folder, "meta/_journal.json"), "utf8"),
  );
  const baseline = JSON.parse(
    await readFile(path.join(folder, "state/0081_manifest.json"), "utf8"),
  );
  const promoted =
    journal.entries.length >= 82 &&
    journal.entries[81]?.tag === manifest.proposed_migration_tag;
  if (
    journal.entries.some(
      (entry, index) =>
        entry.idx !== index ||
        !new RegExp(
          `^${String(index).padStart(4, "0")}_[a-z0-9_-]+$`,
          "u",
        ).test(entry.tag) ||
        !Number.isSafeInteger(entry.when) ||
        (index > 0 && entry.when <= journal.entries[index - 1].when),
    ) ||
    (journal.entries.length !== 81 && !promoted) ||
    journal.entries[80]?.tag !== manifest.committed_prefix_head ||
    baseline.migrations.length !== 82 ||
    baseline.migrations[81]?.tag !== manifest.proposed_migration_tag ||
    baseline.migrations[81]?.sha256 !== manifest.canonical_sha256
  )
    throw new Error("candidate_baseline_changed");
  const prefixEntries = journal.entries.slice(0, 81);
  // Later canonical migrations are outside this historical witness. Accept an
  // appended journal only with the exact frozen prefix and promoted 0081 bytes.
  // Retain the validated buffers so the copied SQL cannot change after hashing.
  const prefixSources = [];
  for (const entry of journal.entries.slice(0, promoted ? 82 : 81)) {
    const pinned = baseline.migrations[entry.idx];
    const bytes = await readFile(path.join(folder, `${entry.tag}.sql`));
    if (
      pinned?.idx !== entry.idx ||
      pinned.tag !== entry.tag ||
      digest(bytes) !== pinned.sha256
    )
      throw new Error("candidate_baseline_changed");
    if (entry.idx <= 80) prefixSources.push({ entry, bytes });
  }
  const observed = [];
  const chunks = [];
  for (const segment of manifest.segments) {
    if (
      !/^docs\/superpowers\/implementation-artifacts\/drafts\/[a-zA-Z0-9_]+\.sql$/u.test(
        segment.source,
      )
    )
      throw new Error("candidate_source_invalid");
    const bytes = await readFile(path.join(root, segment.source));
    let selected = bytes;
    if (segment.selection.kind === "prefix_before_exact_marker") {
      const marker = Buffer.from(segment.selection.marker);
      const cut = bytes.indexOf(marker);
      if (cut < 0 || bytes.indexOf(marker, cut + 1) >= 0)
        throw new Error("candidate_selection_changed");
      selected = bytes.subarray(0, cut);
    } else if (segment.selection.kind !== "entire_file")
      throw new Error("candidate_selection_invalid");
    if (
      !observeCurrentSources &&
      (digest(bytes) !== segment.source_sha256 ||
        digest(selected) !== segment.selected_sha256)
    )
      throw new Error("candidate_source_changed");
    // Roles/credentials belong in separately reviewed operator provisioning.
    if (/^\s*(?:CREATE\s+ROLE\b|GRANT\s+)/imu.test(selected.toString("utf8")))
      throw new Error("candidate_role_provisioning_forbidden");
    observed.push({
      source: segment.source,
      sourceSha256: digest(bytes),
      selectedSha256: digest(selected),
      bytes: selected.length,
    });
    chunks.push(
      Buffer.from(`-- Candidate segment ${segment.order}: ${segment.source}\n`),
      selected,
    );
    if (selected.at(-1) !== 10) chunks.push(Buffer.from("\n"));
    chunks.push(Buffer.from("--> statement-breakpoint\n"));
  }
  const candidate = Buffer.concat(chunks);
  const tag = manifest.proposed_migration_tag;
  if (!/^0081_[a-z0-9_]+$/u.test(tag)) throw new Error("candidate_tag_invalid");
  if (
    promoted &&
    digest(await readFile(path.join(folder, `${tag}.sql`))) !==
      digest(candidate)
  )
    throw new Error("candidate_canonical_mismatch");
  await mkdir(path.join(output, "meta"), { recursive: true });
  for (const { entry, bytes } of prefixSources)
    await writeFile(path.join(output, `${entry.tag}.sql`), bytes, {
      flag: "wx",
    });
  await writeFile(path.join(output, `${tag}.sql`), candidate, { flag: "wx" });
  journal.entries = prefixEntries;
  const tail = journal.entries.at(-1);
  journal.entries.push({
    idx: 81,
    version: tail.version,
    when: tail.when + 1,
    tag,
    breakpoints: true,
  });
  await writeFile(
    path.join(output, "meta/_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`,
    { flag: "wx" },
  );
  const report = {
    status: "temporary_candidate_not_release_approval",
    observeCurrentSources,
    tag,
    candidateSha256: digest(candidate),
    sources: observed,
  };
  await writeFile(
    path.join(output, "candidate-observation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  return report;
}

export async function assertCandidateSourcesUnchanged(root, observation) {
  for (const source of observation.sources)
    if (
      digest(await readFile(path.join(root, source.source))) !==
      source.sourceSha256
    )
      throw new Error(
        `candidate_source_changed_during_witness:${source.source}`,
      );
}
