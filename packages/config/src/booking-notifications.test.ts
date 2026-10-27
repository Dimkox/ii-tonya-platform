import { expect, it } from "vitest";
import { loadEnv } from "./env.js";
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const capable = {
  ...base,
  CLIENT_TELEGRAM_BOT_KEY: "client",
  TELEGRAM_BOT_TOKEN: `123456:${"a".repeat(35)}`,
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
  BOOKING_CALLBACKS_ENABLED: "true",
  BOOKING_CALLBACK_HMAC_KEY: Buffer.alloc(32, 1).toString("base64url"),
  BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID: "k1",
  BOOKING_CALLBACK_VAULT_KEYS: JSON.stringify({
    k1: Buffer.alloc(32, 2).toString("base64url"),
  }),
  BOOKING_NOTIFICATION_RECOVERY_ENABLED: "true",
};
it("enables capture, sending and recovery together with valid policy", () => {
  expect(
    loadEnv({
      ...capable,
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
      BOOKING_NOTIFICATION_ADMISSION_ENABLED: "true",
      BOOKING_NOTIFICATION_SEND_ENABLED: "true",
    }).bookingNotifications,
  ).toEqual({
    admissionEnabled: true,
    sendEnabled: true,
    recoveryEnabled: true,
  });
});
it.each([
  "BOOKING_NOTIFICATION_SEND_ENABLED",
  "BOOKING_NOTIFICATION_ADMISSION_ENABLED",
])(
  "requires enabled callbacks independently for %s despite present keys",
  (flag) => {
    expect(() =>
      loadEnv({
        ...capable,
        CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
        BOOKING_CALLBACKS_ENABLED: "false",
        [flag]: "true",
      }),
    ).toThrow("booking_notifications_configuration_invalid");
  },
);
it("rejects placeholder capture policy", () => {
  expect(() =>
    loadEnv({
      ...capable,
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "placeholder",
      BOOKING_NOTIFICATION_ADMISSION_ENABLED: "true",
    }),
  ).toThrow("booking_notifications_configuration_invalid");
});
it("drains existing deliveries with new admission disabled", () => {
  expect(
    loadEnv({ ...capable, BOOKING_NOTIFICATION_SEND_ENABLED: "true" })
      .bookingNotifications,
  ).toEqual({
    admissionEnabled: false,
    sendEnabled: true,
    recoveryEnabled: true,
  });
});
it("permits capture separately from outbound sending", () => {
  expect(
    loadEnv({
      ...capable,
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
      BOOKING_NOTIFICATION_ADMISSION_ENABLED: "true",
    }).bookingNotifications,
  ).toEqual({
    admissionEnabled: true,
    sendEnabled: false,
    recoveryEnabled: true,
  });
});
it("requires policy for capture even with all other capabilities", () => {
  expect(() =>
    loadEnv({ ...capable, BOOKING_NOTIFICATION_ADMISSION_ENABLED: "true" }),
  ).toThrow("booking_notifications_configuration_invalid");
});
it.each([
  "BOOKING_NOTIFICATION_SEND_ENABLED",
  "BOOKING_NOTIFICATION_ADMISSION_ENABLED",
])("requires recovery independently for %s", (flag) => {
  expect(() =>
    loadEnv({
      ...capable,
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
      BOOKING_NOTIFICATION_RECOVERY_ENABLED: "false",
      [flag]: "true",
    }),
  ).toThrow("booking_notifications_configuration_invalid");
});
it("disables notification capabilities by default", () => {
  expect(loadEnv(base)).toHaveProperty("bookingNotifications", {
    admissionEnabled: false,
    sendEnabled: false,
    recoveryEnabled: false,
  });
});
it("allows local recovery with only bot identity", () => {
  expect(
    loadEnv({
      ...base,
      CLIENT_TELEGRAM_BOT_KEY: "client",
      BOOKING_NOTIFICATION_RECOVERY_ENABLED: "true",
    }),
  ).toHaveProperty("bookingNotifications", {
    admissionEnabled: false,
    sendEnabled: false,
    recoveryEnabled: true,
  });
});
it.each([
  "BOOKING_NOTIFICATION_SEND_ENABLED",
  "BOOKING_NOTIFICATION_ADMISSION_ENABLED",
])("rejects %s without recovery and callback capabilities", (flag) => {
  expect(() => loadEnv({ ...base, [flag]: "true" })).toThrow(
    "booking_notifications_configuration_invalid",
  );
});
it.each([
  "BOOKING_NOTIFICATION_SEND_ENABLED",
  "BOOKING_NOTIFICATION_ADMISSION_ENABLED",
  "BOOKING_NOTIFICATION_RECOVERY_ENABLED",
])("rejects malformed %s", (flag) => {
  expect(() => loadEnv({ ...base, [flag]: "yes" })).toThrow(
    "booking_notifications_configuration_invalid",
  );
});
it("rejects recovery without identity", () => {
  expect(() =>
    loadEnv({ ...base, BOOKING_NOTIFICATION_RECOVERY_ENABLED: "true" }),
  ).toThrow("booking_notifications_configuration_invalid");
});
