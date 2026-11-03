#!/usr/bin/env node
// Tags the commit that production serves and publishes a GitHub release for it.
// Usage: node scripts/tag-production-release.mjs <full-sha> --date YYYY-MM-DD
//          [--evidence <repo path>] [--host ii-tonya.ru] [--skip-live-check] [--dry-run]
// Reads only the public /SOURCE_SHA endpoint. Never reads secrets or touches the host.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const FULL_SHA = /^[0-9a-f]{40}$/;

export function releaseTag(sha) {
  if (!FULL_SHA.test(sha))
    throw new Error(`expected a full 40-char lowercase SHA, got "${sha}"`);
  return `prod-${sha.slice(0, 8)}`;
}

export function parseArgs(argv) {
  const opts = { host: "ii-tonya.ru", liveCheck: true, dryRun: false };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--date") opts.date = rest.shift();
    else if (arg === "--evidence") opts.evidence = rest.shift();
    else if (arg === "--host") opts.host = rest.shift();
    else if (arg === "--skip-live-check") opts.liveCheck = false;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (!opts.sha && !arg.startsWith("--")) opts.sha = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.sha) throw new Error("missing <full-sha>");
  releaseTag(opts.sha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date ?? ""))
    throw new Error("--date YYYY-MM-DD is required");
  return opts;
}

export function releaseNotes({ sha, date, host, evidence, liveSha }) {
  const lines = [
    `Deployed native release. Источник: \`${sha}\`, deployed ${date} (${host}).`,
    "",
    liveSha
      ? `Проверено при тегировании: публичный \`https://${host}/SOURCE_SHA\` = \`${liveSha}\`.`
      : "Live-проверка `/SOURCE_SHA` пропущена (историческая запись).",
  ];
  if (evidence)
    lines.push(
      "",
      `Доказательства: \`${evidence}\`, \`docs/runbooks/native-production-deployment.md\`.`,
    );
  return lines.join("\n") + "\n";
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tag = releaseTag(opts.sha);
  sh("git", ["fetch", "--quiet", "origin", "main"]);
  try {
    sh("git", ["merge-base", "--is-ancestor", opts.sha, "origin/main"]);
  } catch {
    throw new Error(`${opts.sha} is not on origin/main`);
  }
  let liveSha;
  if (opts.liveCheck) {
    const res = await fetch(`https://${opts.host}/SOURCE_SHA`);
    liveSha = (await res.text()).trim();
    if (liveSha !== opts.sha)
      throw new Error(
        `production serves ${liveSha}, not ${opts.sha}; use --skip-live-check only for historical tags`,
      );
  }
  const notes = releaseNotes({ ...opts, liveSha });
  const ghArgs = [
    "release",
    "create",
    tag,
    "--target",
    opts.sha,
    "--title",
    `prod ${opts.sha.slice(0, 8)} (${opts.date}, ${opts.host})`,
    "--notes",
    notes,
  ];
  if (!opts.liveCheck) ghArgs.push("--latest=false");
  if (opts.dryRun) {
    process.stdout.write(
      `gh ${ghArgs.map((a) => JSON.stringify(a)).join(" ")}\n`,
    );
    return;
  }
  process.stdout.write(sh("gh", ghArgs) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`tag-production-release: ${error.message}\n`);
    process.exit(1);
  });
}
