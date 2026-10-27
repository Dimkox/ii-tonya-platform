import { expect, it } from "vitest";
import { loadEnv } from "./env.js";

// Synthetic inputs only: no process.env, dotenv, external calls or key provisioning.
const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const key = Buffer.alloc(32, 61).toString("base64url");
const oldKey = Buffer.alloc(32, 62).toString("base64url");
const enabled = {
  ...base,
  BOOKING_CALLBACKS_ENABLED: "true",
  CLIENT_TELEGRAM_BOT_KEY: "client_bot-1",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
  TELEGRAM_BOT_TOKEN: `123456:${"t".repeat(35)}`,
  BOOKING_CALLBACK_HMAC_KEY: key,
  BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID: "v2",
  BOOKING_CALLBACK_VAULT_KEYS: JSON.stringify({ v1: oldKey, v2: key }),
};

it("defaults off without loading key material or enabling legacy integrations", () => {
  const c = loadEnv(base);
  expect(c.features.bookingCallbacks).toBe(false);
  expect(c.bookingCallbacks).toBeUndefined();
  expect(c.integrations.telegram).toBe(false);
});
it("enables callbacks independently of new admission, calendar and legacy Telegram", () => {
  const c = loadEnv(enabled);
  expect(c.features.bookingCallbacks).toBe(true);
  expect(c.bookingCallbacks?.hmacKey).toEqual(
    Uint8Array.from(Buffer.alloc(32, 61)),
  );
  expect(c.bookingCallbacks?.activeKeyId).toBe("v2");
  expect(c.bookingCallbacks?.keys.size).toBe(2);
  expect(c.bookingCallbacks?.keys.get("v1")).toEqual(
    Uint8Array.from(Buffer.alloc(32, 62)),
  );
  expect(c.bookingCallbacks?.keys.get("v2")).toEqual(
    Uint8Array.from(Buffer.alloc(32, 61)),
  );
  expect(c.features.clientBookingReserve).toBe(false);
  expect(c.features.workerOutboxDelivery).toBe(false);
  expect(c.planerkaWorkflow).toBeUndefined();
  expect(c.integrations.telegram).toBe(false);
});
it("disabled callbacks preserve a valid bot key and ignore unavailable callback keys", () => {
  const c = loadEnv({
    ...base,
    BOOKING_CALLBACKS_ENABLED: "false",
    CLIENT_TELEGRAM_BOT_KEY: "legacy.bot-key-1",
    BOOKING_CALLBACK_HMAC_KEY: "unprovisioned",
    BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID: "bad id",
    BOOKING_CALLBACK_VAULT_KEYS: "not-json",
  });
  expect(c.clientTelegramBotKey).toBe("legacy.bot-key-1");
  expect(c.features.bookingCallbacks).toBe(false);
  expect(c.bookingCallbacks).toBeUndefined();
});
it.each([
  "BOOKING_CALLBACK_HMAC_KEY",
  "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID",
  "BOOKING_CALLBACK_VAULT_KEYS",
  "CLIENT_TELEGRAM_BOT_KEY",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
])("enabled callbacks require %s", (field) => {
  const input: NodeJS.ProcessEnv = { ...enabled };
  delete input[field];
  expect(() => loadEnv(input)).toThrow(
    "booking_callbacks_configuration_invalid",
  );
});
it.each(["", "TRUE", "1", "yes", "secret-marker"])(
  "rejects invalid boolean %j without echoing it",
  (value) => {
    expect(() =>
      loadEnv({ ...enabled, BOOKING_CALLBACKS_ENABLED: value }),
    ).toThrow("booking_callbacks_configuration_invalid");
  },
);
it.each([
  { field: "BOOKING_CALLBACK_HMAC_KEY", value: "" },
  { field: "BOOKING_CALLBACK_HMAC_KEY", value: key + "=" },
  { field: "BOOKING_CALLBACK_HMAC_KEY", value: " " + key },
  {
    field: "BOOKING_CALLBACK_HMAC_KEY",
    value: Buffer.alloc(31).toString("base64url"),
  },
  {
    field: "BOOKING_CALLBACK_HMAC_KEY",
    value: Buffer.alloc(33).toString("base64url"),
  },
  { field: "BOOKING_CALLBACK_HMAC_KEY", value: "/".repeat(43) },
  { field: "BOOKING_CALLBACK_HMAC_KEY", value: "A".repeat(42) + "B" },
  { field: "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID", value: "v.2" },
  { field: "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID", value: "кириллица" },
  { field: "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID", value: "v".repeat(65) },
  { field: "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID", value: "" },
  { field: "BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID", value: "absent" },
  { field: "CLIENT_TELEGRAM_BOT_KEY", value: "legacy.bot" },
  { field: "CLIENT_TELEGRAM_BOT_KEY", value: "legacy:bot" },
  { field: "CLIENT_TELEGRAM_BOT_KEY", value: "bot-placeholder" },
  { field: "TELEGRAM_WEBHOOK_SECRET", value: "short" },
  { field: "TELEGRAM_WEBHOOK_SECRET", value: "placeholder".repeat(4) },
  { field: "TELEGRAM_WEBHOOK_SECRET", value: "!".repeat(32) },
  { field: "TELEGRAM_BOT_TOKEN", value: "invalid-secret-marker" },
  { field: "TELEGRAM_BOT_TOKEN", value: `9999999999999999:${"t".repeat(35)}` },
])("rejects invalid $field without exposing values", ({ field, value }) => {
  try {
    loadEnv({ ...enabled, [field]: value });
    throw new Error("accepted_invalid_callback_config");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "booking_callbacks_configuration_invalid",
    );
    expect(JSON.stringify(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(enabled.TELEGRAM_BOT_TOKEN);
  }
});
it.each([
  "not-json",
  "null",
  "[]",
  "{}",
  JSON.stringify({ v2: 1 }),
  JSON.stringify({ v2: { key } }),
  JSON.stringify({ v2: [key] }),
  JSON.stringify({ v2: key + "=" }),
  JSON.stringify({ v2: "A".repeat(42) + "B" }),
  JSON.stringify({ v2: Buffer.alloc(31).toString("base64url") }),
  JSON.stringify({ "bad.id": oldKey, v2: key }),
  JSON.stringify({ ["x".repeat(65)]: oldKey, v2: key }),
  `{"v2":"${key}","v2":"${oldKey}"}`,
  `{"v2":"${key}","v\\u0032":"${oldKey}"}`,
  `{"v2":"${key}",}`,
  JSON.stringify(
    Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`v${i}`, key])),
  ),
  `{"v2":{"nested":"${key}"},"v2":"${key}"}`,
])("rejects malformed, duplicate or oversized vault map %#", (raw) => {
  expect(() =>
    loadEnv({ ...enabled, BOOKING_CALLBACK_VAULT_KEYS: raw }),
  ).toThrow("booking_callbacks_configuration_invalid");
});
it.each([1, 8])("retains all %i unique rotation keys", (count) => {
  const keys = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `v${i}`,
      Buffer.alloc(32, i).toString("base64url"),
    ]),
  );
  const c = loadEnv({
    ...enabled,
    BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID: "v0",
    BOOKING_CALLBACK_VAULT_KEYS: JSON.stringify(keys),
  });
  expect(c.bookingCallbacks?.keys.size).toBe(count);
  for (let i = 0; i < count; i++)
    expect(c.bookingCallbacks?.keys.get(`v${i}`)).toEqual(
      Uint8Array.from(Buffer.alloc(32, i)),
    );
});
it("accepts boundary key IDs and safe Map names without prototype semantics", () => {
  for (const id of ["a", "x".repeat(64), "__proto__", "constructor"]) {
    const c = loadEnv({
      ...enabled,
      BOOKING_CALLBACK_VAULT_ACTIVE_KEY_ID: id,
      BOOKING_CALLBACK_VAULT_KEYS: `{${JSON.stringify(id)}:${JSON.stringify(key)}}`,
    });
    expect(c.bookingCallbacks?.keys.get(id)).toEqual(
      Uint8Array.from(Buffer.alloc(32, 61)),
    );
  }
});
it("parses JSON whitespace and escaped IDs but returns independent key buffers per load", () => {
  const input = {
    ...enabled,
    BOOKING_CALLBACK_VAULT_KEYS: ` { "v\\u0032" : "${key}" } \n`,
  };
  const a = loadEnv(input),
    b = loadEnv(input);
  expect(a.bookingCallbacks?.keys.size).toBe(1);
  a.bookingCallbacks!.hmacKey[0] = 0;
  a.bookingCallbacks!.keys.get("v2")![0] = 0;
  expect(b.bookingCallbacks!.hmacKey[0]).toBe(61);
  expect(b.bookingCallbacks!.keys.get("v2")![0]).toBe(61);
});
