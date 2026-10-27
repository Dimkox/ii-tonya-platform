import { beforeEach, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
const captured = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof import("@ii-tonya/db")>();
  return {
    ...actual,
    PostgresBookingRepository: class extends actual.PostgresBookingRepository {
      constructor(
        ...args: ConstructorParameters<typeof actual.PostgresBookingRepository>
      ) {
        super(...args);
        captured.options.push(args[1]);
      }
    },
  };
});
import { createDefaultLifecycle } from "./server.js";
beforeEach(() => {
  captured.options = [];
});
const base = () => {
  const c = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  c.features.clientBooking = true;
  c.features.clientSession = true;
  c.features.clientCatalog = true;
  c.features.workerOutboxDelivery = true;
  c.clientTelegramBotToken = `123456:${"a".repeat(35)}`;
  return c;
};
const db = { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb;
it("binds new reservation capture to configured bot and consent version", async () => {
  const c = Object.assign(base(), {
    clientTelegramBotKey: "client",
    clientMessagingConsentPolicyVersion: "messaging-v1",
    bookingNotifications: {
      admissionEnabled: true,
      sendEnabled: false,
      recoveryEnabled: true,
    },
  });
  await createDefaultLifecycle().dependencies(c, db);
  expect(captured.options).toContainEqual({
    notificationOrigin: {
      botKey: "client",
      messagingPolicyVersion: "messaging-v1",
    },
  });
});
it("does not capture an origin when admission is off", async () => {
  await createDefaultLifecycle().dependencies(base(), db);
  expect(
    captured.options.every(
      (o) => !o || !Object.hasOwn(o, "notificationOrigin"),
    ),
  ).toBe(true);
});
it.each([
  "clientTelegramBotKey",
  "clientMessagingConsentPolicyVersion",
] as const)("refuses missing %s independently", async (missing) => {
  const c = Object.assign(base(), {
    clientTelegramBotKey: "client",
    clientMessagingConsentPolicyVersion: "messaging-v1",
    bookingNotifications: {
      admissionEnabled: true,
      sendEnabled: false,
      recoveryEnabled: true,
    },
  });
  Reflect.deleteProperty(c, missing);
  const result = await createDefaultLifecycle()
    .dependencies(c, db)
    .then(
      () => "resolved",
      (e: unknown) => (e instanceof Error ? e.message : "error"),
    );
  expect(result).toBe("booking_notification_capture_configuration_required");
});
