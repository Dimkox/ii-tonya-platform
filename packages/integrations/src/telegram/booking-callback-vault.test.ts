import { expect, it } from "vitest";
import {
  createBookingCallbackVault,
  type BookingCallbackBinding,
} from "./booking-callback-vault.js";

const key = () => new Uint8Array(32).fill(7);
const token = `ct2.${Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 12)]).toString("base64url")}`;
const binding = (): BookingCallbackBinding => ({
  deliveryId: "11111111-1111-4111-8111-111111111111",
  notificationId: "22222222-2222-4222-8222-222222222222",
  reservationId: "33333333-3333-4333-8333-333333333333",
  expertId: "44444444-4444-4444-8444-444444444444",
  botKey: "client",
  chatId: "201",
  action: "confirm",
  version: 1,
  expiresAtEpochSeconds: 1800000000,
});
const vault = () =>
  createBookingCallbackVault({
    activeKeyId: "one",
    keys: new Map([["one", key()]]),
  });

it("authenticates key ID even when two IDs have identical key bytes", () => {
  const v = createBookingCallbackVault({
    activeKeyId: "one",
    keys: new Map([
      ["one", key()],
      ["alias", key()],
    ]),
  });
  const sealed = v.seal(token, binding());
  expect(() => v.open({ ...sealed, keyId: "alias" }, binding())).toThrow(
    "booking_callback_vault_invalid",
  );
});

it("rejects noncanonical pad-bit aliases of an otherwise authentic envelope", () => {
  const v = vault();
  const sealed = v.seal(token, binding());
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const encoded = sealed.ciphertext.slice(5);
  const last = alphabet.indexOf(encoded.at(-1)!);
  const alias = encoded.slice(0, -1) + alphabet[last | 1];
  expect(Buffer.from(alias, "base64url")).toEqual(
    Buffer.from(encoded, "base64url"),
  );
  expect(() =>
    v.open({ ...sealed, ciphertext: `bcn1.${alias}` }, binding()),
  ).toThrow("booking_callback_vault_invalid");
});
it("recovers exact token only from its authenticated binding", () => {
  const v = vault();
  const b = binding();
  const sealed = v.seal(token, b);
  expect(sealed.keyId).toBe("one");
  expect(sealed.ciphertext).not.toContain(token);
  expect(v.open(sealed, b)).toBe(token);
});
it("uses a fresh nonce for each seal", () => {
  const v = vault();
  const a = v.seal(token, binding());
  const b = v.seal(token, binding());
  expect(a.ciphertext).not.toBe(b.ciphertext);
  expect(v.open(a, binding())).toBe(token);
  expect(v.open(b, binding())).toBe(token);
});
it.each([
  ["deliveryId", "55555555-5555-4555-8555-555555555555"],
  ["notificationId", "55555555-5555-4555-8555-555555555555"],
  ["reservationId", "55555555-5555-4555-8555-555555555555"],
  ["expertId", "55555555-5555-4555-8555-555555555555"],
  ["botKey", "other"],
  ["chatId", "202"],
  ["action", "cancel"],
  ["version", 2],
  ["expiresAtEpochSeconds", 1800000001],
])("rejects substitution of %s", (field, value) => {
  const v = vault();
  const sealed = v.seal(token, binding());
  expect(() => v.open(sealed, { ...binding(), [field]: value })).toThrow(
    "booking_callback_vault_invalid",
  );
});
it.each([0, 12, 30, 75])(
  "rejects nonce/ciphertext/tag tampering at byte%s",
  (index) => {
    const v = vault();
    const sealed = v.seal(token, binding());
    const raw = Buffer.from(sealed.ciphertext.slice(5), "base64url");
    raw[index] = raw[index]! ^ 1;
    expect(() =>
      v.open(
        { ...sealed, ciphertext: `bcn1.${raw.toString("base64url")}` },
        binding(),
      ),
    ).toThrow("booking_callback_vault_invalid");
  },
);
it("rotation retains old-key decrypt but uses active key for sealing", () => {
  const old = vault().seal(token, binding());
  const v = createBookingCallbackVault({
    activeKeyId: "two",
    keys: new Map([
      ["one", key()],
      ["two", new Uint8Array(32).fill(9)],
    ]),
  });
  expect(v.open(old, binding())).toBe(token);
  expect(v.seal(token, binding()).keyId).toBe("two");
  expect(() => v.open({ ...old, keyId: "two" }, binding())).toThrow(
    "booking_callback_vault_invalid",
  );
});
it("copies caller keys and map instead of retaining mutable authority", () => {
  const bytes = key();
  const keys = new Map([["one", bytes]]);
  const v = createBookingCallbackVault({ activeKeyId: "one", keys });
  const sealed = v.seal(token, binding());
  bytes.fill(0);
  keys.clear();
  expect(v.open(sealed, binding())).toBe(token);
});
it.each(["", "unknown"])("rejects missing active key%s", (activeKeyId) => {
  expect(() =>
    createBookingCallbackVault({
      activeKeyId,
      keys: new Map([["one", key()]]),
    }),
  ).toThrow("booking_callback_vault_configuration_invalid");
});
it.each([0, 16, 31, 33])("rejects key length%s", (length) => {
  expect(() =>
    createBookingCallbackVault({
      activeKeyId: "one",
      keys: new Map([["one", new Uint8Array(length)]]),
    }),
  ).toThrow("booking_callback_vault_configuration_invalid");
});
it.each(["", "ct2.bad", `ct2.${"a".repeat(44)}`, token + "=", "secret"])(
  "rejects malformed plaintext%s",
  (bad) => {
    expect(() => vault().seal(bad, binding())).toThrow(
      "booking_callback_vault_invalid",
    );
  },
);
it.each([
  "",
  "bcn2.abc",
  "bcn1." + "a".repeat(103),
  "bcn1." + "a".repeat(100000),
])("rejects malformed envelope%#", (ciphertext) => {
  expect(() => vault().open({ keyId: "one", ciphertext }, binding())).toThrow(
    "booking_callback_vault_invalid",
  );
});
it("rejects unknown key without leaking ciphertext", () => {
  const sealed = vault().seal(token, binding());
  expect(() => vault().open({ ...sealed, keyId: "gone" }, binding())).toThrow(
    /^booking_callback_vault_invalid$/u,
  );
});
it("canonicalizes field order but never checks eligibility against local clock", () => {
  const v = vault();
  const b = { ...binding(), expiresAtEpochSeconds: 1 };
  const sealed = v.seal(token, b);
  const reordered = Object.fromEntries(
    Object.entries(b).reverse(),
  ) as unknown as BookingCallbackBinding;
  expect(v.open(sealed, reordered)).toBe(token);
});
