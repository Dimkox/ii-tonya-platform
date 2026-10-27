import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const req = createRequire(new URL("../../../package.json", import.meta.url));
const { transform } = createRequire(req.resolve("tsup"))("esbuild");
const path = "packages/integrations/src/documents/verification-extraction.ts";
const baseline = process.env.PRIVATE_EXTRACTION_BASELINE_SHA;
const source = baseline
  ? execFileSync("git", ["show", baseline + ":" + path], { encoding: "utf8" })
  : readFileSync(path, "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { proposeVerificationFields } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
assert.deepEqual(
  proposeVerificationFields("Специализация: " + "я".repeat(301), {}),
  {},
);
const proposal = proposeVerificationFields(
  ["Мотивация", "Путь", "Кейсы", "Методы", "Программа"]
    .map((k) => k + ": " + "я".repeat(999))
    .join("\n"),
  {},
);
assert(JSON.stringify(proposal).length <= 2500);
console.log(
  JSON.stringify({ specialty301Excluded: true, completePreviewBound: true }),
);
