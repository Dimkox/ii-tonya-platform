import { expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const navigation = {
  ...base,
  CLIENT_TELEGRAM_NAVIGATION_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(35)}`,
  TELEGRAM_WEBHOOK_SECRET: "synthetic_secret_".repeat(3),
  CLIENT_TELEGRAM_BOT_KEY: "synthetic-route-key",
  CLIENT_WEB_ORIGIN: "https://client.example",
};
const bookingNavigation = {
  ...navigation,
  CLIENT_SESSION_ENABLED: "true",
  CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: "fixture_bot",
  CLIENT_CATALOG_ENABLED: "true",
  CLIENT_BOOKING_ENABLED: "true",
  CLIENT_SESSION_BOOKING_GRANTS_ENABLED: "true",
  WORKER_OUTBOX_DELIVERY_ENABLED: "true",
};
it("permits navigation alongside the complete local catalogue booking chain", () => {
  expect(loadEnv(bookingNavigation).features).toMatchObject({
    clientTelegramNavigation: true,
    clientBooking: true,
    workerOutboxDelivery: true,
    clientBookingReserve: false,
    b2TelegramDispatch: false,
    clientTelegramIngress: false,
  });
});
it.each([
  "CLIENT_TELEGRAM_INGRESS_ENABLED",
  "CLIENT_HYBRID_ROUTING_ENABLED",
  "B2_TELEGRAM_DISPATCH_ENABLED",
  "TEST_EXPERT_SELARTI_ENABLED",
])("still rejects external/content processing with booking: %s", (flag) => {
  expect(() => loadEnv({ ...bookingNavigation, [flag]: "true" })).toThrow();
});
it("defaults navigation off", () => {
  expect(loadEnv(base).features.clientTelegramNavigation).toBe(false);
});
it("permits navigation with sessions, consents, providers and content ingress off", () => {
  const config = loadEnv(navigation);
  expect(config.features.clientTelegramNavigation).toBe(true);
  expect(config.clientNavigation).toEqual({ origin: "https://client.example" });
  expect(config.clientWeb).toBeUndefined();
  expect(config.features.clientSession).toBe(false);
  expect(config.features.clientTelegramIngress).toBe(false);
});
it("rolls navigation-only configuration back without forcing sessions or retaining web-only settings", () => {
  expect(loadEnv(navigation).features.clientSession).toBe(false);
  expect(() =>
    loadEnv({ ...navigation, CLIENT_TELEGRAM_NAVIGATION_ENABLED: "false" }),
  ).toThrow("client_web_configuration_incomplete");
  const config = loadEnv({
    ...navigation,
    CLIENT_TELEGRAM_NAVIGATION_ENABLED: "false",
    CLIENT_SESSION_ENABLED: "false",
    CLIENT_WEB_ORIGIN: undefined,
    CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: undefined,
    CLIENT_TELEGRAM_WIDGET_LOGIN_ENABLED: "false",
  });
  expect(config.clientNavigation).toBeUndefined();
  expect(config.clientWeb).toBeUndefined();
  expect(config.features.clientSession).toBe(false);
  expect(config.features.clientTelegramNavigation).toBe(false);
  expect(config.features.clientTelegramIngress).toBe(false);
  expect(config.features.clientHybridRouting).toBe(false);
  expect(config.features.workerOutboxDelivery).toBe(false);
});
it.each([
  "CLIENT_TELEGRAM_INGRESS_ENABLED",
  "CLIENT_HYBRID_ROUTING_ENABLED",
  "TEST_EXPERT_PROMO_ENABLED",
  "TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED",
  "TEST_EXPERT_SELARTI_ENABLED",
  "TEST_EXPERT_RECONCILIATION_ENABLED",
  "WORKER_OUTBOX_DELIVERY_ENABLED",
  "B2_TELEGRAM_DISPATCH_ENABLED",
  "SELARTI_COST_ADMISSION_ENABLED",
  "SELARTI_RESPONSE_INGRESS_ENABLED",
])("rejects competing processor %s", (flag) => {
  expect(() => loadEnv({ ...navigation, [flag]: "true" })).toThrow();
});
it.each([
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "CLIENT_TELEGRAM_BOT_KEY",
  "CLIENT_WEB_ORIGIN",
])("requires %s", (key) => {
  expect(() => loadEnv({ ...navigation, [key]: undefined })).toThrow();
});
it.each([
  ["CLIENT_WEB_ORIGIN", "http://client.example"],
  ["CLIENT_WEB_ORIGIN", "https://client.example/"],
  ["CLIENT_WEB_ORIGIN", "https://client.example/path"],
  ["CLIENT_WEB_ORIGIN", "https://user:pass@client.example"],
  ["CLIENT_WEB_ORIGIN", "https://client.example?query=1"],
  ["CLIENT_WEB_ORIGIN", "https://client.example#hash"],
  ["TELEGRAM_BOT_TOKEN", `9007199254740992:${"a".repeat(35)}`],
  ["TELEGRAM_BOT_TOKEN", "placeholder"],
  ["CLIENT_TELEGRAM_BOT_KEY", "placeholder"],
  ["TELEGRAM_WEBHOOK_SECRET", "placeholder_".repeat(4)],
])("rejects invalid dependency %s=%s", (key, value) => {
  expect(() => loadEnv({ ...navigation, [key]: value })).toThrow();
});
