import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createIsolatedDocumentParser } from "../../../packages/integrations/dist/index.js";
const parser = createIsolatedDocumentParser({
  socketPath: "/tmp/residency-private-parser-20261026/socket/parser.sock",
  ocr: true,
});
for (const [name, type] of [
  ["text.pdf", "pdf"],
  ["scan.pdf", "pdf"],
  ["scan.png", "png"],
  ["brief.docx", "docx"],
]) {
  const bytes = await readFile(
      "/tmp/residency-private-parser-20261026/" + name,
    ),
    start = performance.now();
  const result = await parser.parse({
    bytes,
    type,
    signal: new AbortController().signal,
  });
  assert(result, "required actual parser witness " + name);
  assert.match(result.content, /Психолог/);
  assert.match(result.content, /Казань/);
  console.log(
    JSON.stringify({
      fixture: name,
      type,
      bytes: bytes.length,
      elapsedMs: Math.round(performance.now() - start),
      recognizedCyrillic: true,
      contentBytes: Buffer.byteLength(result.content),
    }),
  );
}
assert.equal(
  await parser.parse({
    bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
    type: "pdf",
    signal: new AbortController().signal,
  }),
  null,
);
const controller = new AbortController();
controller.abort();
assert.equal(
  await parser.parse({
    bytes: Buffer.from("x"),
    type: "pdf",
    signal: controller.signal,
  }),
  null,
);
console.log(
  JSON.stringify({
    oversizeDenied: true,
    abortedDenied: true,
    nodeRssBytes: process.memoryUsage().rss,
  }),
);
