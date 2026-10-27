import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createPrivateObjectStore } from "./private-verification.js";
import { proposeVerificationFields } from "./verification-extraction.js";
it("R3 proposals obey specialty and displayed aggregate limits", () => {
  expect(
    proposeVerificationFields("Специализация: " + "я".repeat(301), {}),
  ).toEqual({});
  const p = proposeVerificationFields(
    ["Мотивация", "Путь", "Кейсы", "Методы", "Программа"]
      .map((k) => k + ": " + "я".repeat(999))
      .join("\n"),
    {},
  );
  expect(JSON.stringify(p).length).toBeLessThanOrEqual(2500);
});
const bytes = Buffer.from("%PDF-1.7\ncontradictory-head"),
  id = "00000000-0000-4000-8000-000000000001",
  proof = {
    key: "custody/" + id,
    custodyId: id,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    mimeType: "application/pdf",
  };
for (const header of [
  "x-amz-checksum-sha256",
  "x-amz-meta-sha256",
  "x-amz-meta-custody-id",
  "x-amz-meta-schema",
  "content-length",
  "content-type",
  "x-amz-version-id",
])
  for (const missing of [false, true])
    it(`R7 successful HEAD contradicts ${header} missing=${missing}`, async () => {
      const server = createServer((req, res) => {
        if (req.method === "PUT") {
          res.end();
          return;
        }
        const headers: Record<string, string> = {
          "x-amz-checksum-sha256": Buffer.from(proof.sha256, "hex").toString(
            "base64",
          ),
          "x-amz-meta-sha256": proof.sha256,
          "x-amz-meta-custody-id": id,
          "x-amz-meta-schema": "1",
          "content-length": String(bytes.length),
          "content-type": proof.mimeType,
        };
        if (header === "x-amz-version-id" && missing) {
          /* Normal non-versioned positive proof. */
        } else if (missing) delete headers[header];
        else
          headers[header] = header === "content-length" ? "1" : "contradiction";
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        res.end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      try {
        const store = createPrivateObjectStore({
          bucket: "local-fixture",
          region: "test-1",
          endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          credentials: {
            accessKeyId: "fixture",
            secretAccessKey: "fixture-secret",
          },
          dedicatedNonVersionedVerified: true,
          localEvidence: true,
        });
        expect(
          (
            await store.put({
              ...proof,
              bytes,
              signal: new AbortController().signal,
            })
          ).kind,
        ).toBe(
          header === "x-amz-version-id" && missing ? "verified" : "unknown",
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
