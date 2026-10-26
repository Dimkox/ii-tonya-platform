import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createPrivateObjectStore } from "./private-verification.js";
const bytes = Buffer.from("%PDF-1.7\nrecovery fixture"),
  id = "00000000-0000-4000-8000-000000000001",
  proof = {
    key: "custody/" + id,
    custodyId: id,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    mimeType: "application/pdf",
  };
it("real SDK proves matching conditional conflict and distinguishes HEAD403 from absence", async () => {
  let forbidden = false;
  const methods: string[] = [];
  const server = createServer((req, res) => {
    methods.push(req.method!);
    if (req.method === "PUT") {
      res.statusCode = 412;
      res.end();
    } else if (forbidden) {
      res.statusCode = 403;
      res.end();
    } else {
      res.setHeader("content-length", bytes.length);
      res.setHeader("content-type", proof.mimeType);
      res.setHeader(
        "x-amz-checksum-sha256",
        Buffer.from(proof.sha256, "hex").toString("base64"),
      );
      res.setHeader("x-amz-meta-sha256", proof.sha256);
      res.setHeader("x-amz-meta-custody-id", id);
      res.setHeader("x-amz-meta-schema", "1");
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const store = createPrivateObjectStore({
      bucket: "private-fixture",
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
      await store.put({
        ...proof,
        bytes,
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "verified" });
    expect(methods).toEqual(["PUT", "HEAD"]);
    forbidden = true;
    expect(await store.head(proof, new AbortController().signal)).toEqual({
      kind: "unknown",
    });
    expect(methods).toEqual(["PUT", "HEAD", "HEAD"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
it("requires explicit credentials even when ambient credentials exist", () => {
  const prior = {
    id: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
  };
  process.env.AWS_ACCESS_KEY_ID = "ambient-fixture";
  process.env.AWS_SECRET_ACCESS_KEY = "ambient-fixture-secret";
  try {
    expect(() =>
      createPrivateObjectStore({
        bucket: "private-fixture",
        region: "test-1",
        endpoint: "https://private.example.test",
        credentials: { accessKeyId: "", secretAccessKey: "" },
        dedicatedNonVersionedVerified: true,
      }),
    ).toThrow("private_store_configuration");
  } finally {
    if (prior.id === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = prior.id;
    if (prior.secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = prior.secret;
  }
});
