import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientBookingRoutes } from "./client-booking.js";

const token = `cs1.${"A".repeat(43)}`;
const choiceHandle = `ch1.${"B".repeat(43)}`;
const bookingHandle = `bk1.${"C".repeat(43)}`;
const userId = "00000000-0000-4000-8000-000000000101";

const appFor = async (input?: { reserveEnabled?: boolean }) => {
  const reserve = vi.fn(async () => ({
    created: true,
    bookingHandle,
    state: "reserved" as const,
    reservedUntil: "2026-08-16T11:00:00.000Z",
  }));
  const cancel = vi.fn(async () => ({
    bookingHandle,
    state: "cancelled" as const,
  }));
  const app = Fastify();
  await app.register(clientBookingRoutes, {
    principals: {
      resolve: async () => ({
        kind: "resolved" as const,
        principal: {
          authenticated: true as const,
          active: true as const,
          userId,
        },
      }),
    },
    bookings: { reserve, cancel },
    reserveEnabled: input?.reserveEnabled ?? true,
  });
  return { app, reserve, cancel };
};

describe("client booking routes", () => {
  it("accepts only the exact reserve body and emits the frozen public shape", async () => {
    const { app, reserve } = await appFor();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/bookings",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
      },
      payload: JSON.stringify({ choiceHandle }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      bookingHandle,
      state: "reserved",
      reservedUntil: "2026-08-16T11:00:00.000Z",
    });
    expect(reserve).toHaveBeenCalledWith(
      { authenticated: true, active: true, userId },
      { choiceHandle },
    );
    await app.close();
  });

  it.each([
    ["extra key", JSON.stringify({ choiceHandle, slotId: userId })],
    [
      "duplicate key",
      `{"choiceHandle":"${choiceHandle}","choiceHandle":"${choiceHandle}"}`,
    ],
    ["trailing byte", `${JSON.stringify({ choiceHandle })}x`],
  ])("rejects %s before service access", async (_name, payload) => {
    const { app, reserve } = await appFor();
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/bookings",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
    expect(reserve).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps owner cancellation available while reserve is killed", async () => {
    const { app, reserve, cancel } = await appFor({ reserveEnabled: false });
    const reserveResponse = await app.inject({
      method: "POST",
      url: "/v1/client/bookings",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ choiceHandle }),
    });
    expect(reserveResponse.statusCode).toBe(503);
    expect(reserveResponse.json()).toEqual({ error: "feature_disabled" });
    expect(reserve).not.toHaveBeenCalled();
    const cancelResponse = await app.inject({
      method: "DELETE",
      url: `/v1/client/bookings/${bookingHandle}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toEqual({
      bookingHandle,
      state: "cancelled",
    });
    expect(cancel).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a percent-encoded booking handle before cancellation", async () => {
    const { app, cancel } = await appFor();
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/client/bookings/%62${bookingHandle.slice(1)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_request" });
    expect(cancel).not.toHaveBeenCalled();
    await app.close();
  });
});
