import { createServer } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  createTelegramDocumentReader,
  createPrivateObjectStore,
} from "../../../packages/integrations/dist/index.js";
const bytes = Buffer.alloc(20 * 1024 * 1024, 32);
bytes.write("%PDF-1.7\n");
const id = "00000000-0000-4000-8000-000000000099",
  sha = createHash("sha256").update(bytes).digest("hex");
let peak = process.memoryUsage().rss;
const sample = setInterval(
  () => (peak = Math.max(peak, process.memoryUsage().rss)),
  2,
);
const server = createServer((q, s) => {
  if (q.url.endsWith("/getFile"))
    s.end(
      JSON.stringify({
        ok: true,
        result: {
          file_id: "memory_fixture",
          file_size: bytes.length,
          file_path: "documents/memory.pdf",
        },
      }),
    );
  else if (q.url.startsWith("/file/")) {
    s.setHeader("content-length", bytes.length);
    s.end(bytes);
  } else if (q.method === "HEAD") {
    s.setHeader("content-length", bytes.length);
    s.setHeader("content-type", "application/pdf");
    s.setHeader(
      "x-amz-checksum-sha256",
      Buffer.from(sha, "hex").toString("base64"),
    );
    s.setHeader("x-amz-meta-sha256", sha);
    s.setHeader("x-amz-meta-custody-id", id);
    s.setHeader("x-amz-meta-schema", "1");
    s.end();
  } else {
    q.resume();
    q.on("end", () => s.end());
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  const reader = createTelegramDocumentReader({
    botId: "123",
    token: "123:SYNTHETIC",
    fetch: (url, init) => fetch(origin + new URL(url).pathname, init),
  });
  const read = await reader.read({
    botId: "123",
    fileId: "memory_fixture",
    size: bytes.length,
    mimeType: "application/pdf",
    signal: new AbortController().signal,
  });
  assert.equal(read.kind, "read");
  const store = createPrivateObjectStore({
    bucket: "memory-fixture",
    region: "test-1",
    endpoint: origin,
    credentials: {
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
    },
    dedicatedNonVersionedVerified: true,
    localEvidence: true,
  });
  assert.deepEqual(
    await store.put({
      key: "custody/" + id,
      custodyId: id,
      sha256: sha,
      size: bytes.length,
      mimeType: "application/pdf",
      bytes: read.bytes,
      signal: new AbortController().signal,
    }),
    { kind: "verified" },
  );
  peak = Math.max(peak, process.memoryUsage().rss);
  console.log(
    JSON.stringify({
      documentBytes: bytes.length,
      peakRssBytes: peak,
      ceilingBytes: 256 * 1024 * 1024,
      headroomBytes: 256 * 1024 * 1024 - peak,
      includesLocalFixtureServer: true,
    }),
  );
  assert(peak < 256 * 1024 * 1024);
} finally {
  clearInterval(sample);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
