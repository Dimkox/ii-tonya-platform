import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ClientBookingNotFoundError } from "@ii-tonya/application";
import { clientBookingRoutes } from "./client-booking.js";

const handle = `bk1.${"A".repeat(43)}`;
const principal = {
  authenticated: true,
  active: true,
  userId: "00000000-0000-4000-8000-000000000101",
} as const;
const setup = async (denied = false, missing = false) => {
  const app = Fastify();
  const list = vi.fn(async () => {
    if (missing) throw new ClientBookingNotFoundError();
    return { bookings: [], nextCursor: null };
  });
  await app.register(clientBookingRoutes, {
    principals: {
      resolve: async () =>
        denied ? { kind: "denied" } : { kind: "resolved", principal },
    },
    bookings: { list, reserve: vi.fn(), cancel: vi.fn() },
    reserveEnabled: false,
  });
  return { app, list };
};
const headers = { authorization: `Bearer cs1.${"B".repeat(43)}` };
describe("owner booking list HTTP boundary", () => {
  it("keeps reads available with reserve disabled and forwards only an owned cursor", async () => {
    const { app, list } = await setup();
    try {
      const response = await app.inject({
        url: `/v1/client/bookings?after=${handle}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ bookings: [], nextCursor: null });
      expect(list).toHaveBeenCalledWith(principal, handle);
    } finally {
      await app.close();
    }
  });
  it.each([
    "?after=bad",
    `?after=${handle}&after=${handle}`,
    "?userId=other",
    "?after=",
    `?after=${handle}&x=1`,
    `?after=${handle.replace(".", "%2E")}`,
  ])("rejects noncanonical query %s", async (query) => {
    const { app, list } = await setup();
    try {
      const response = await app.inject({
        url: `/v1/client/bookings${query}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(list).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("denies access before reading rows", async () => {
    const { app, list } = await setup(true);
    try {
      const response = await app.inject({
        url: "/v1/client/bookings",
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(list).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("normalizes missing and foreign anchors to a no-store 404", async () => {
    const { app } = await setup(false, true);
    try {
      const response = await app.inject({
        url: `/v1/client/bookings?after=${handle}`,
        headers,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
});
