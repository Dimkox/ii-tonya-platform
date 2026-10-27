import { expect, it } from "vitest";
import { PrivacyClient } from "./privacy-client.js";
import { BookingClient } from "./booking-client.js";
it("accepts pending calendar and pending cancellation without presenting them as booked", async () => {
  const session = new PrivacyClient(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("/session")
            ? {
                available: true,
                authenticated: true,
                csrfToken: "a".repeat(64),
                bookingAvailable: true,
                bookingReserveAvailable: true,
              }
            : {
                bookings: ["calendar_pending", "cancellation_pending"].map(
                  (state, i) => ({
                    bookingHandle: `bk1.${String(i).repeat(43)}`,
                    state,
                    startsAt: "2026-10-20T10:00:00Z",
                    reservedUntil: "2026-10-19T10:00:00Z",
                  }),
                ),
                nextCursor: null,
              },
        ),
        { status: 200 },
      ),
  );
  await session.probe();
  expect(
    (await new BookingClient(session).list()).bookings.map((r) => r.state),
  ).toEqual(["calendar_pending", "cancellation_pending"]);
});
it("uses cancellation response instead of inferring success from an incomplete page", async () => {
  const handle = `bk1.${"A".repeat(43)}`;
  const session = new PrivacyClient(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("/session")
            ? {
                available: true,
                authenticated: true,
                csrfToken: "a".repeat(64),
                bookingAvailable: true,
                bookingReserveAvailable: true,
              }
            : String(url).endsWith(handle)
              ? { bookingHandle: handle, state: "cancellation_pending" }
              : { bookings: [], nextCursor: null },
        ),
        { status: 200 },
      ),
  );
  await session.probe();
  const client = new BookingClient(session);
  expect(await client.cancel(handle)).toBe("cancellation_pending");
  expect((await client.list()).bookings).toEqual([]);
});
