import { expect, it, vi } from "vitest";
import { createYooKassaClient } from "./client.js";
const config = {
  mode: "test",
  shopId: "test-shop",
  secretKey: "synthetic-secret",
} as const;
const args = {
  createdFrom: "2026-11-01T00:00:00.000Z",
  createdTo: "2026-11-02T00:00:00.000Z",
  limit: 2,
  cursor: "next/cursor",
} as const;
it("performs bounded GET and returns only candidate identifiers and cursor", async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          type: "list",
          items: [
            {
              id: "p1",
              created_at: "2026-11-01T01:00:00.000Z",
              test: true,
              metadata: {
                operation_id: "operation",
                order_id: "order",
                private_email: "do-not-return",
              },
              payment_method: { card: "private" },
            },
          ],
          next_cursor: "following",
        }),
        { status: 200 },
      ),
  );
  const client = createYooKassaClient(config, transport);
  const result = await client.listPayments(args);
  const [url, init] = transport.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(new URL(url).origin).toBe("https://api.yookassa.ru");
  expect(new URL(url).pathname).toBe("/v3/payments");
  expect(new URL(url).searchParams.get("created_at.gte")).toBe(
    args.createdFrom,
  );
  expect(new URL(url).searchParams.get("created_at.lte")).toBe(args.createdTo);
  expect(new URL(url).searchParams.get("cursor")).toBe(args.cursor);
  expect(init.method).toBe("GET");
  expect(result).toEqual({
    items: [
      {
        id: "p1",
        test: true,
        createdAt: "2026-11-01T01:00:00.000Z",
        metadata: { operation_id: "operation", order_id: "order" },
      },
    ],
    nextCursor: "following",
  });
});
it("rejects invalid bounds and preserves candidate mode", async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          type: "list",
          items: [
            {
              id: "p1",
              created_at: "2026-11-01T01:00:00.000Z",
              test: false,
              metadata: {},
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const client = createYooKassaClient(config, transport);
  await expect(client.listPayments({ ...args, limit: 101 })).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  expect((await client.listPayments(args)).items[0]?.test).toBe(false);
});

it("allows unrelated payments without metadata and retains matching candidates", async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          type: "list",
          items: [
            {
              id: "unrelated",
              created_at: "2026-11-01T02:00:00.000Z",
              test: true,
            },
            {
              id: "target",
              created_at: "2026-11-01T01:00:00.000Z",
              test: true,
              metadata: { operation_id: "operation", order_id: "order" },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const result = await createYooKassaClient(config, transport).listPayments(
    args,
  );
  expect(result.items).toEqual([
    {
      id: "unrelated",
      test: true,
      createdAt: "2026-11-01T02:00:00.000Z",
      metadata: {},
    },
    {
      id: "target",
      test: true,
      createdAt: "2026-11-01T01:00:00.000Z",
      metadata: { operation_id: "operation", order_id: "order" },
    },
  ]);
});

it("handles a large bounded page and ignores unusable unrelated metadata", async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: `p${i}`,
    created_at: "2026-11-01T01:00:00.000Z",
    test: true,
    metadata: i === 0 ? { order_id: null, operation_id: "x".repeat(512) } : {},
    private_field: "p".repeat(4000),
  }));
  const transport = vi.fn(
    async () =>
      new Response(JSON.stringify({ type: "list", items }), { status: 200 }),
  );
  const result = await createYooKassaClient(config, transport).listPayments({
    ...args,
    limit: 100,
  });
  expect(result.items).toHaveLength(100);
  expect(result.items[0]?.metadata).toEqual({});
  expect(JSON.stringify(result)).not.toContain("private_field");
});

it("rejects a list response over the 2 MiB limit", async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          type: "list",
          items: [],
          private: "x".repeat(2 * 1024 * 1024),
        }),
        { status: 200 },
      ),
  );
  await expect(
    createYooKassaClient(config, transport).listPayments(args),
  ).rejects.toThrow("yookassa_response_invalid");
});
