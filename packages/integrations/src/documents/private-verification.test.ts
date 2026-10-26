import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTelegramDocumentReader,
  createVkWallReader,
  createPrivateObjectStore,
} from "./private-verification.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function fixture(
  handler: (q: IncomingMessage, s: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as { port: number };
  const origin = `http://127.0.0.1:${a.port}`;
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  const transport: typeof fetch = (input, init) => {
    const u = new URL(String(input));
    return fetch(origin + u.pathname + u.search, init);
  };
  return { origin, transport };
}
const bytes = Buffer.from("%PDF-1.7\nsynthetic private document\n");
const doc = {
  fileId: "file_original",
  size: bytes.length,
  mimeType: "application/pdf",
};
const abort = () => new AbortController().signal;
describe("bounded original-bot custody transport", () => {
  it("uses original bot and verifies getFile identity, declared size and actual bytes", async () => {
    const seen: string[] = [];
    const f = await fixture((q, s) => {
      seen.push(q.url!);
      if (q.url!.endsWith("/getFile"))
        s.end(
          JSON.stringify({
            ok: true,
            result: {
              file_id: doc.fileId,
              file_size: bytes.length,
              file_path: "documents/file.pdf",
            },
          }),
        );
      else {
        s.setHeader("content-length", bytes.length);
        s.end(bytes);
      }
    });
    const reader = createTelegramDocumentReader({
      botId: "123",
      token: "123:CANARY_PRIVATE",
      fetch: f.transport,
    });
    expect(
      await reader.read({ ...doc, botId: "123", signal: abort() }),
    ).toEqual({ kind: "read", bytes, mimeType: "application/pdf" });
    expect(seen).toEqual([
      "/bot123:CANARY_PRIVATE/getFile",
      "/file/bot123:CANARY_PRIVATE/documents/file.pdf",
    ]);
    expect(
      await reader.read({ ...doc, botId: "456", signal: abort() }),
    ).toEqual({ kind: "unavailable", reason: "source_identity" });
    expect(seen).toHaveLength(2);
  });
  it.each([
    "../secret",
    "/absolute",
    "a/%2e%2e/b",
    "a\\b",
    "a//b",
    "a?token=x",
    "a#x",
    "https://evil/a",
  ])("denies unsafe path %s without download", async (path) => {
    let calls = 0;
    const f = await fixture((_q, s) => {
      calls++;
      s.end(
        JSON.stringify({
          ok: true,
          result: {
            file_id: doc.fileId,
            file_size: bytes.length,
            file_path: path,
          },
        }),
      );
    });
    expect(
      await createTelegramDocumentReader({
        botId: "123",
        token: "123:CANARY_PRIVATE",
        fetch: f.transport,
      }).read({ ...doc, botId: "123", signal: abort() }),
    ).toEqual({ kind: "unavailable", reason: "invalid_file" });
    expect(calls).toBe(1);
  });
  it.each([
    "wrong_identity",
    "wrong_size",
    "redirect",
    "truncated",
    "oversized",
    "wrong_magic",
    "timeout",
    "abort",
  ])("never reports read for %s", async (mode) => {
    const f = await fixture((q, s) => {
      if (q.url!.endsWith("/getFile")) {
        s.end(
          JSON.stringify({
            ok: true,
            result: {
              file_id: mode === "wrong_identity" ? "other" : doc.fileId,
              file_size: mode === "wrong_size" ? 999 : bytes.length,
              file_path: "documents/a.pdf",
            },
          }),
        );
        return;
      }
      if (mode === "redirect") {
        s.writeHead(302, { location: "http://127.0.0.1:1/private" });
        s.end();
      } else if (mode === "timeout" || mode === "abort") {
        s.writeHead(200);
        s.flushHeaders();
      } else if (mode === "truncated") {
        s.setHeader("content-length", bytes.length + 2);
        s.write(bytes);
        setTimeout(() => s.destroy(), 5);
      } else
        s.end(
          mode === "oversized"
            ? Buffer.alloc(bytes.length + 1)
            : Buffer.alloc(bytes.length),
        );
    });
    const controller = new AbortController();
    if (mode === "abort") setTimeout(() => controller.abort(), 10);
    const result = await createTelegramDocumentReader({
      botId: "123",
      token: "123:CANARY_PRIVATE",
      fetch: f.transport,
      timeoutMs: 40,
    }).read({ ...doc, botId: "123", signal: controller.signal });
    expect(result.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("CANARY_PRIVATE");
  });
});
describe("VK observed history", () => {
  it("selects five newest posts despite an old pinned post; missing comments stay null", async () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const sec = +now / 1000;
    const f = await fixture((q, s) => {
      expect(q.method).toBe("POST");
      s.end(
        JSON.stringify({
          response: {
            count: 6,
            items: [
              { id: 1, date: sec - 9999999, is_pinned: 1 },
              ...Array.from({ length: 5 }, (_, i) => ({
                id: i + 2,
                date: sec - i * 100,
                attachments: i === 0 ? [{ type: "photo" }] : [],
                ...(i === 1 ? { comments: { count: 3 } } : {}),
              })),
            ],
          },
        }),
      );
    });
    const r = await createVkWallReader({
      token: "CANARY_VK",
      tokenKind: "service",
      fetch: f.transport,
    }).observe("https://vk.com/club123", now, abort());
    expect(r.coverage).toBe("complete_latest");
    expect(r.posts).toHaveLength(5);
    expect(r.posts[0]).toEqual({
      id: "2",
      publishedAt: now.toISOString(),
      hasMedia: true,
      comments: null,
    });
    expect(r.activity).toBe("ACTIVE");
    expect(r.score).toBeNull();
  });
  it("strict 30-day boundary and unsupported sources are unknown", async () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const f = await fixture((_q, s) =>
      s.end(
        JSON.stringify({
          response: {
            count: 1,
            items: [{ id: 1, date: +now / 1000 - 30 * 86400 }],
          },
        }),
      ),
    );
    const reader = createVkWallReader({
      token: "CANARY_VK",
      tokenKind: "user",
      fetch: f.transport,
    });
    expect(
      (await reader.observe("https://vk.com/id123", now, abort())).activity,
    ).toBe("ACTIVE");
    expect(
      (
        await reader.observe(
          "https://vk.com/id123",
          new Date(+now + 1),
          abort(),
        )
      ).activity,
    ).toBe("INACTIVE");
    expect(
      (await reader.observe("https://instagram.com/test", now, abort()))
        .activity,
    ).toBe("UNKNOWN");
  });
});
describe("real SDK private S3 transport", () => {
  it("signs conditional PUT and validates HEAD checksum/metadata/length before custody, presigns 120s and deletes", async () => {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const key = "custody/00000000-0000-4000-8000-000000000001";
    let puts = 0,
      heads = 0,
      deletes = 0;
    const f = await fixture((q, s) => {
      expect(q.headers.authorization).toContain("Credential=local-access/");
      if (q.method === "PUT") {
        puts++;
        expect(q.headers["if-none-match"]).toBe("*");
        expect(q.headers["x-amz-checksum-sha256"]).toBe(
          Buffer.from(digest, "hex").toString("base64"),
        );
        s.end();
      } else if (q.method === "HEAD") {
        heads++;
        s.setHeader("content-length", bytes.length);
        s.setHeader("content-type", "application/pdf");
        s.setHeader(
          "x-amz-checksum-sha256",
          Buffer.from(digest, "hex").toString("base64"),
        );
        s.setHeader("x-amz-meta-sha256", digest);
        s.setHeader("x-amz-meta-custody-id", key.slice(8));
        s.setHeader("x-amz-meta-schema", "1");
        s.end();
      } else {
        deletes++;
        s.end();
      }
    });
    const store = createPrivateObjectStore({
      bucket: "private-fixture",
      region: "test-1",
      endpoint: f.origin,
      credentials: {
        accessKeyId: "local-access",
        secretAccessKey: "local-secret",
      },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
    });
    const input = {
      key,
      custodyId: key.slice(8),
      sha256: digest,
      size: bytes.length,
      mimeType: "application/pdf",
    };
    expect(await store.put({ ...input, bytes, signal: abort() })).toEqual({
      kind: "verified",
    });
    expect(puts).toBe(1);
    expect(heads).toBe(1);
    const u = new URL(await store.presign(input));
    expect(u.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(u.searchParams.get("response-content-disposition")).toBe(
      "attachment",
    );
    expect(u.searchParams.get("response-cache-control")).toBe("no-store");
    expect(await store.remove(key, abort())).toBe("deleted");
    expect(deletes).toBe(1);
  });
  it.each([403, 409, 412, 500])(
    "preserves ambiguity for response %i and never retries",
    async (status) => {
      let calls = 0;
      const f = await fixture((_q, s) => {
        calls++;
        s.statusCode = status;
        s.end();
      });
      const store = createPrivateObjectStore({
        bucket: "private-fixture",
        region: "test-1",
        endpoint: f.origin,
        credentials: {
          accessKeyId: "local-access",
          secretAccessKey: "local-secret",
        },
        dedicatedNonVersionedVerified: true,
        localEvidence: true,
      });
      const result = await store.put({
        key: "custody/00000000-0000-4000-8000-000000000001",
        custodyId: "00000000-0000-4000-8000-000000000001",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        mimeType: "application/pdf",
        bytes,
        signal: abort(),
      });
      expect(result.kind).toBe("unknown");
      expect(calls).toBe(status === 412 ? 2 : 1);
    },
  );
  it("rejects unverified/versioned activation and absent explicit credentials", () => {
    expect(() =>
      createPrivateObjectStore({
        bucket: "private",
        region: "test-1",
        endpoint: "https://s3.example.test",
        credentials: { accessKeyId: "", secretAccessKey: "" },
        dedicatedNonVersionedVerified: false,
      }),
    ).toThrow("private_store_configuration");
  });
});

describe("sanitized genuine Telegram public preview fixture", () => {
  it("reports observed five posts as unofficial partial, never inferred inactivity or comments", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createTelegramPreviewReader } =
      await import("./private-verification.js");
    const html = await readFile(
      new URL("./fixtures/telegram-public-preview.html", import.meta.url),
      "utf8",
    );
    const f = await fixture((q, s) => {
      expect(q.url).toBe("/s/telegram");
      s.end(html);
    });
    const r = await createTelegramPreviewReader({ fetch: f.transport }).observe(
      "https://t.me/telegram",
      new Date("2026-10-26"),
      abort(),
    );
    expect(r.posts.map((p) => p.id)).toEqual([
      "460",
      "459",
      "458",
      "457",
      "456",
    ]);
    expect(r.coverage).toBe("partial");
    expect(r.activity).toBe("UNKNOWN");
    expect(r.posts.every((p) => p.comments === null)).toBe(true);
  });
});
