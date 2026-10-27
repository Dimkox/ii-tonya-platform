import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyClient } from "./privacy-client.js";
import { BookingClient } from "./booking-client.js";

const id = "00000000-0000-4000-8000-000000000101";
const choice = `ch1.${"A".repeat(43)}`;
const bk = `bk1.${"B".repeat(43)}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function setup(
  handler: (path: string, init?: RequestInit) => Promise<Response>,
) {
  let csrf = "a".repeat(64);
  const request = vi.fn<typeof fetch>(async (url, init) =>
    String(url).endsWith("/session")
      ? json({
          available: true,
          authenticated: true,
          csrfToken: csrf,
          bookingAvailable: true,
          bookingReserveAvailable: true,
        })
      : handler(String(url), init),
  );
  const session = new PrivacyClient(request);
  await session.probe();
  return {
    session,
    client: new BookingClient(session),
    request,
    switchAccount: async () => {
      csrf = "b".repeat(64);
      await session.probe();
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("shared-session booking client", () => {
  it("requests a structured catalogue and returns ready protected choices", async () => {
    const { client, request } = await setup(async (path) =>
      path.endsWith("catalog-requests")
        ? json({ catalogRequestId: id, state: "pending" }, 202)
        : json({
            catalogRequestId: id,
            state: "ready",
            cards: [
              {
                displayName: "Expert",
                serviceCode: "career",
                language: "ru",
                availability: "fresh_slots",
                slots: [
                  {
                    startsAt: "2026-10-10T12:00:00.000Z",
                    choiceHandle: choice,
                  },
                ],
              },
            ],
          }),
    );
    expect(
      (await client.catalog({ serviceCode: "career", language: "ru" }))[0]
        ?.slots[0]?.choiceHandle,
    ).toBe(choice);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      credentials: "same-origin",
      headers: { "x-csrf-token": "a".repeat(64) },
      body: '{"serviceCode":"career","language":"ru"}',
    });
  });
  it("stops after ten pending polls without automatically starting another request", async () => {
    vi.useFakeTimers();
    const { client, request } = await setup(async () =>
      json({ catalogRequestId: id, state: "pending" }),
    );
    const result = expect(client.catalog({})).rejects.toThrow(
      "catalog_pending",
    );
    await vi.runAllTimersAsync();
    await result;
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith(id)),
    ).toHaveLength(10);
  });
  it("locks duplicate writes and reconciles a lost reserve response before another explicit action", async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    const { client, request } = await setup(async (_path, init) =>
      init?.method === "POST"
        ? new Promise((_resolve, reject) => {
            rejectWrite = reject;
          })
        : json({ bookings: [], nextCursor: null }),
    );
    const first = client.reserve(choice);
    const firstRejected = expect(first).rejects.toThrow("lost");
    await expect(client.reserve(choice)).rejects.toThrow("booking_busy");
    rejectWrite!(new Error("lost"));
    await firstRejected;
    await expect(client.cancel(bk)).rejects.toThrow(
      "booking_reconciliation_required",
    );
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    await client.list();
    expect(client.needsReconciliation).toBe(false);
  });
  it("keeps uncertain writes blocked until the final explicitly loaded page", async () => {
    const { client } = await setup(async (path, init) =>
      init?.method === "POST"
        ? Promise.reject(new Error("lost"))
        : json({
            bookings: [],
            nextCursor: path.includes("after=") ? null : bk,
          }),
    );
    await expect(client.reserve(choice)).rejects.toThrow("lost");
    await client.list();
    expect(client.needsReconciliation).toBe(true);
    await client.list(bk);
    expect(client.needsReconciliation).toBe(false);
  });
  it("discards a pending old-account response", async () => {
    let resolve: ((r: Response) => void) | undefined;
    const { client, switchAccount } = await setup(
      async () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = client.list();
    const rejected = expect(pending).rejects.toThrow("stale");
    await switchAccount();
    resolve!(json({ bookings: [], nextCursor: null }));
    await rejected;
  });
  it("disposal prevents further requests", async () => {
    const { client, request } = await setup(async () =>
      json({ bookings: [], nextCursor: null }),
    );
    client.dispose();
    await expect(client.list()).rejects.toThrow("stale");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
