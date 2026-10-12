import Fastify from "fastify";
import { expect, it } from "vitest";
import { clientBookingRoutes } from "./client-booking.js";
it("returns calendar pending and asynchronous cancellation honestly without provider internals", async () => {
  const app = Fastify();
  const bookingHandle = `bk1.${"A".repeat(43)}` as const;
  await app.register(clientBookingRoutes, {
    principals: {
      resolve: async () => ({
        kind: "resolved",
        principal: {
          authenticated: true,
          active: true,
          userId: "00000000-0000-4000-8000-000000000101",
        },
      }),
    },
    bookings: {
      list: async () => ({
        bookings: [
          {
            bookingHandle,
            state: "calendar_pending",
            startsAt: "2026-10-20T10:00:00Z",
            reservedUntil: "2026-10-19T10:00:00Z",
          },
        ],
        nextCursor: null,
      }),
      reserve: async () => {
        throw new Error("unexpected");
      },
      cancel: async () => ({ bookingHandle, state: "cancellation_pending" }),
    },
    reserveEnabled: false,
  });
  try {
    const headers = { authorization: `Bearer cs1.${"B".repeat(43)}` };
    const page = await app.inject({
      method: "GET",
      url: "/v1/client/bookings",
      headers,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      bookings: [{ state: "calendar_pending" }],
    });
    const cancelled = await app.inject({
      method: "DELETE",
      url: `/v1/client/bookings/${bookingHandle}`,
      headers,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json()).toEqual({
      bookingHandle,
      state: "cancellation_pending",
    });
  } finally {
    await app.close();
  }
});
