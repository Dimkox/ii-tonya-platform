import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgres://local:local@localhost:5432/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const enabled = {
  ...base,
  CLIENT_SESSION_ENABLED: "true",
  CLIENT_CATALOG_ENABLED: "true",
  CLIENT_BOOKING_ENABLED: "true",
  WORKER_OUTBOX_DELIVERY_ENABLED: "true",
  CLIENT_SESSION_BOOKING_GRANTS_ENABLED: "true",
};
it("defaults booking grant issuance off", () => {
  expect(loadEnv(base).features).toHaveProperty(
    "clientSessionBookingGrants",
    false,
  );
});
it("allows fresh cancellation authority while reservation creation is off", () => {
  expect(
    loadEnv({ ...enabled, CLIENT_BOOKING_RESERVE_ENABLED: "false" }).features,
  ).toMatchObject({
    clientSessionBookingGrants: true,
    clientBookingReserve: false,
  });
});
it.each(["CLIENT_SESSION_ENABLED", "CLIENT_BOOKING_ENABLED"])(
  "requires %s for issuance",
  (key) => {
    expect(() => loadEnv({ ...enabled, [key]: "false" })).toThrow();
  },
);
it("rejects nonliteral issuance switches", () => {
  expect(() =>
    loadEnv({ ...enabled, CLIENT_SESSION_BOOKING_GRANTS_ENABLED: "yes" }),
  ).toThrow();
});
