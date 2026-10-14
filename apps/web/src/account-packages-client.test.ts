import { expect, it } from "vitest";
import { PrivacyClient } from "./privacy-client.js";

const snapshot = {
  asOf: "2026-10-10T10:00:00.000Z",
  totalRemainingUnits: "9",
  hasMore: false,
  packages: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "paid",
      grantedUnits: 10,
      remainingUnits: "9",
      expiresAt: null,
      status: "active",
    },
  ],
};
function fixture(payload: unknown = snapshot) {
  const calls: RequestInit[] = [];
  let binding = "a";
  let pending: (() => Promise<Response>) | undefined;
  const client = new PrivacyClient(async (url, init) => {
    calls.push(init!);
    return String(url).endsWith("/session")
      ? Response.json({
          available: true,
          authenticated: true,
          csrfToken: binding,
        })
      : pending
        ? pending()
        : Response.json(payload);
  });
  return {
    client,
    calls,
    switch: () => {
      binding = "b";
    },
    hold: (fn: () => Promise<Response>) => {
      pending = fn;
    },
  };
}
it("reads actual packages using only a bound GET", async () => {
  const f = fixture();
  await f.client.probe();
  expect(await f.client.packages()).toEqual(snapshot);
  expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  expect(f.calls[1]).toMatchObject({
    cache: "no-store",
    headers: { "x-csrf-token": "a" },
  });
});
it("preserves microsecond expiry ordering and accepts all package kinds", async () => {
  for (const kind of ["paid", "admin", "intro"]) {
    const f = fixture({
      ...snapshot,
      packages: [
        {
          ...snapshot.packages[0],
          kind,
          expiresAt: "2026-10-10T10:00:00.000001Z",
        },
      ],
    });
    await f.client.probe();
    expect((await f.client.packages()).packages[0]?.status).toBe("active");
  }
  const f = fixture({
    ...snapshot,
    totalRemainingUnits: "0",
    packages: [
      { ...snapshot.packages[0], expiresAt: snapshot.asOf, status: "expired" },
    ],
  });
  await f.client.probe();
  expect((await f.client.packages()).packages[0]?.status).toBe("expired");
});
it.each([
  null,
  {},
  { ...snapshot, totalRemainingUnits: "-1" },
  { ...snapshot, asOf: "not-a-date" },
  ...[
    { id: "<script>" },
    { remainingUnits: "-1" },
    { remainingUnits: "1.5" },
    { grantedUnits: 0 },
    { expiresAt: "2026-02-30T00:00:00.000Z" },
    { status: "expired" },
    { kind: "coupon" },
  ].map((p) => ({
    ...snapshot,
    packages: [{ ...snapshot.packages[0], ...p }],
  })),
  { ...snapshot, totalRemainingUnits: "10" },
  { ...snapshot, packages: Array(51).fill(snapshot.packages[0]) },
])("rejects malformed package payload %j", async (payload) => {
  const f = fixture(payload);
  await f.client.probe();
  await expect(f.client.packages()).rejects.toThrow();
});
it("rejects anonymous and late responses from the previous authority", async () => {
  const f = fixture();
  await expect(f.client.packages()).rejects.toThrow();
  await f.client.probe();
  let finish!: (r: Response) => void;
  f.hold(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.client.packages();
  f.switch();
  await f.client.probe();
  finish(Response.json(snapshot));
  await expect(pending).rejects.toThrow("stale_response");
});
it("rejects duplicate UUIDs with different casing", async () => {
  const id = "abcdefab-1234-4567-89ab-abcdefabcdef";
  const f = fixture({
    ...snapshot,
    totalRemainingUnits: "18",
    packages: [
      { ...snapshot.packages[0], id },
      { ...snapshot.packages[0], id: id.toUpperCase() },
    ],
  });
  await f.client.probe();
  await expect(f.client.packages()).rejects.toThrow("packages_unavailable");
});
it("requires exact totals once a truncated active-first list reaches inactive packages", async () => {
  const packages = Array.from({ length: 50 }, (_, i) => ({
    ...snapshot.packages[0],
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    remainingUnits: i < 49 ? "9" : "0",
    status: i < 49 ? "active" : "exhausted",
  }));
  for (const status of ["exhausted", "expired"]) {
    const rows = packages.map((p, i) =>
      i === 49
        ? {
            ...p,
            status,
            expiresAt: status === "expired" ? snapshot.asOf : null,
          }
        : p,
    );
    const bad = fixture({
      ...snapshot,
      hasMore: true,
      totalRemainingUnits: "450",
      packages: rows,
    });
    await bad.client.probe();
    await expect(bad.client.packages()).rejects.toThrow("packages_unavailable");
    const good = fixture({
      ...snapshot,
      hasMore: true,
      totalRemainingUnits: "441",
      packages: rows,
    });
    await good.client.probe();
    expect((await good.client.packages()).totalRemainingUnits).toBe("441");
  }
});
