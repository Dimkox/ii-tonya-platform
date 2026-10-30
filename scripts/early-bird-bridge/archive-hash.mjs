import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";

export function archiveSource(sha, output) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("invalid source SHA");
  execFileSync("git", ["archive", "--format=tar", `--output=${output}`, sha], {
    stdio: "ignore",
  });
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
