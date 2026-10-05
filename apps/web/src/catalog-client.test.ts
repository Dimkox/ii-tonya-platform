import { afterEach, expect, it, vi } from "vitest";
import { PublicCatalogClient } from "./catalog-client.js";

const item = { displayName: "Эксперт", serviceCode: "career", language: "ru" };
afterEach(() => vi.useRealTimers());

it("fetches only the fixed public URL, omitting credentials and referrers, caching and redirects", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ items: [{ ...item, sourceKey: "private" }] }),
  );
  expect(await new PublicCatalogClient(request).list()).toEqual([item]);
  expect(request).toHaveBeenCalledExactlyOnceWith("/v1/public/catalog", {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: expect.any(AbortSignal),
  });
});
it("accepts honest empty inventory and bounded maximum fields", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({
        items: Array.from({ length: 20 }, () => ({
          displayName: "n".repeat(200),
          serviceCode: "s".repeat(64),
          language: "l".repeat(32),
        })),
      }),
    );
  const client = new PublicCatalogClient(request);
  expect(await client.list()).toEqual([]);
  expect(await client.list()).toHaveLength(20);
});
it.each([
  null,
  {},
  { items: null },
  { items: [null] },
  { items: new Array(21).fill(item) },
  { items: [{ ...item, displayName: " " }] },
  { items: [{ ...item, displayName: "n".repeat(201) }] },
  { items: [{ ...item, serviceCode: "s".repeat(65) }] },
  { items: [{ ...item, serviceCode: "" }] },
  { items: [{ ...item, language: "l".repeat(33) }] },
  { items: [{ ...item, language: "ru\u0085" }] },
  { items: [{ ...item, displayName: 42 }] },
  { items: [{ ...item, displayName: "a\nb" }] },
  ...[
    "\u202e",
    "\u202d",
    "\u202a",
    "\u202b",
    "\u202c",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
  ].map((control) => ({ items: [{ ...item, displayName: `Name${control}` }] })),
  ...[
    "\u200b",
    "\u200d",
    "\u2060",
    "\ufe0f",
    "\u034f",
    "\u2800",
    "\u3164",
    " \u200b\u200d ",
  ].map((invisible) => ({ items: [{ ...item, serviceCode: invisible }] })),
])("fails closed on malformed data %#", async (body) => {
  await expect(
    new PublicCatalogClient(async () => Response.json(body)).list(),
  ).rejects.toThrow("catalog_unavailable");
});
it.each([503, 401, 302])("reports HTTP %i as failure", async (status) => {
  await expect(
    new PublicCatalogClient(
      async () => new Response("private error", { status }),
    ).list(),
  ).rejects.toThrow("catalog_unavailable");
});
it("sanitizes network and body decoding failures", async () => {
  for (const request of [
    async () => {
      throw new Error("private transport details");
    },
    async () => new Response("private malformed JSON"),
  ]) {
    await expect(new PublicCatalogClient(request).list()).rejects.toThrow(
      /^catalog_unavailable$/u,
    );
  }
});
it.each(["request", "body"])(
  "bounds a hung %s and allows a successful retry despite a late response",
  async (stage) => {
    vi.useFakeTimers();
    const late = Promise.withResolvers<Response>();
    const lateBody = Promise.withResolvers<unknown>();
    let signal: AbortSignal | undefined;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, options) => {
        signal = options?.signal as AbortSignal;
        return stage === "request"
          ? late.promise
          : new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  void lateBody.promise.then((body) => {
                    if (signal?.aborted) return;
                    controller.enqueue(
                      new TextEncoder().encode(JSON.stringify(body)),
                    );
                    controller.close();
                  });
                },
              }),
            );
      })
      .mockResolvedValueOnce(Response.json({ items: [item] }));
    const client = new PublicCatalogClient(request);
    const failed = expect(client.list()).rejects.toThrow("catalog_unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(signal?.aborted).toBe(true);
    expect(await client.list()).toEqual([item]);
    late.resolve(Response.json({ items: [] }));
    lateBody.resolve({ items: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

function streamed(text: string, chunkSize: number, headers?: HeadersInit) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (offset >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
    headers === undefined ? {} : { headers },
  );
  return { response, cancel };
}
it("decodes split UTF-8 bytes and retains useful ZWJ within visible names", async () => {
  const joined = { ...item, displayName: "Эксперт 👩‍💻 نام‍" };
  const { response } = streamed(JSON.stringify({ items: [joined] }), 1);
  expect(await new PublicCatalogClient(async () => response).list()).toEqual([
    joined,
  ]);
});
it("accepts exactly 64KiB of JSON bytes", async () => {
  const base = JSON.stringify({ items: [item], unknown: "" });
  const body = JSON.stringify({
    items: [item],
    unknown: "x".repeat(65_536 - new TextEncoder().encode(base).length),
  });
  const { response } = streamed(body, 997);
  expect(await new PublicCatalogClient(async () => response).list()).toEqual([
    item,
  ]);
});
it.each(["content-length", "stream-overflow"])(
  "rejects %s before parsing and cancels the body",
  async (mode) => {
    const body = JSON.stringify({ items: [item], unknown: "x".repeat(65_536) });
    const { response, cancel } = streamed(
      body,
      32_768,
      mode === "content-length" ? { "content-length": "65537" } : {},
    );
    const parse = vi.spyOn(JSON, "parse");
    try {
      await expect(
        new PublicCatalogClient(async () => response).list(),
      ).rejects.toThrow(/^catalog_unavailable$/u);
      expect(parse.mock.calls.some(([value]) => value === body)).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  },
);
