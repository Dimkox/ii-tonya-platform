import { expect, it } from "vitest";
import * as integrations from "../index.js";

type Binding = {
  id: string;
  quoteId: string;
  userId: string;
  kind: "email";
  basis: string;
  capturedAt: string;
  expiresAt: string;
};
type Envelope = { keyId: string; ciphertext: string };
type Vault = {
  seal(email: string, binding: Binding): Envelope;
  open(envelope: Envelope, binding: Binding): string;
};
const api = integrations as unknown as {
  createPayerReceiptVault(options: {
    activeKeyId: string;
    keys: ReadonlyMap<string, Uint8Array>;
  }): Vault;
  resolvePayerReceiptKeys(raw: string): ReadonlyMap<string, Uint8Array>;
};
const binding: Binding = {
  id: "11111111-1111-4111-8111-111111111111",
  quoteId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  kind: "email",
  basis: "fiscal_payment_dec_plt_004_v1",
  capturedAt: "2026-10-12T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:00.000Z",
};
const options = {
  activeKeyId: "r1",
  keys: new Map([["r1", new Uint8Array(32).fill(17)]]),
};
it("randomizes encryption, authenticates every binding field and retains old keys", () => {
  expect(api.createPayerReceiptVault).toBeTypeOf("function");
  const vault = api.createPayerReceiptVault(options);
  const a = vault.seal("payer@example.test", binding),
    b = vault.seal("payer@example.test", binding);
  expect(a.ciphertext).not.toBe(b.ciphertext);
  expect(a.ciphertext).not.toContain("payer");
  expect(vault.open(a, binding)).toBe("payer@example.test");
  for (const changed of [
    { ...binding, id: "44444444-4444-4444-8444-444444444444" },
    { ...binding, quoteId: "44444444-4444-4444-8444-444444444444" },
    { ...binding, userId: "44444444-4444-4444-8444-444444444444" },
    { ...binding, capturedAt: "2026-10-13T00:00:00.000Z" },
    { ...binding, expiresAt: "2026-11-12T00:00:00.000Z" },
  ]) {
    // Each altered binding is independently valid, so rejection below proves
    // authentication rather than malformed UUID/timestamp schema validation.
    expect(vault.open(vault.seal("payer@example.test", changed), changed)).toBe(
      "payer@example.test",
    );
    expect(() => vault.open(a, changed)).toThrow("payer_receipt_vault_invalid");
  }
  // Kind/basis are single-valued policies; alternatives are schema rejection.
  expect(() =>
    vault.open(a, { ...binding, kind: "phone" } as unknown as Binding),
  ).toThrow("payer_receipt_vault_invalid");
  expect(() => vault.open(a, { ...binding, basis: "unapproved" })).toThrow(
    "payer_receipt_vault_invalid",
  );
  expect(() => vault.open({ ...a, keyId: "unknown" }, binding)).toThrow(
    "payer_receipt_vault_invalid",
  );
  expect(() =>
    vault.open(
      {
        ...a,
        ciphertext: `${a.ciphertext.slice(0, 20)}${a.ciphertext[20] === "A" ? "B" : "A"}${a.ciphertext.slice(21)}`,
      },
      binding,
    ),
  ).toThrow("payer_receipt_vault_invalid");
  const wrong = api.createPayerReceiptVault({
    activeKeyId: "r1",
    keys: new Map([["r1", new Uint8Array(32).fill(99)]]),
  });
  expect(() => wrong.open(a, binding)).toThrow("payer_receipt_vault_invalid");
  const aliased = api.createPayerReceiptVault({
    activeKeyId: "r1",
    keys: new Map([...options.keys, ["rAlias", new Uint8Array(32).fill(17)]]),
  });
  expect(() => aliased.open({ ...a, keyId: "rAlias" }, binding)).toThrow(
    "payer_receipt_vault_invalid",
  );
  const rotated = api.createPayerReceiptVault({
    activeKeyId: "r2",
    keys: new Map([...options.keys, ["r2", new Uint8Array(32).fill(19)]]),
  });
  expect(rotated.open(a, binding)).toBe("payer@example.test");
  expect(rotated.seal("payer@example.test", binding).keyId).toBe("r2");
});
it("rejects invalid email and oversized envelopes with sanitized errors", () => {
  expect(api.createPayerReceiptVault).toBeTypeOf("function");
  const vault = api.createPayerReceiptVault(options);
  for (const email of [
    "",
    "not-email",
    "x\n@example.test",
    `${"x".repeat(255)}@example.test`,
  ])
    expect(() => vault.seal(email, binding)).toThrow(
      "payer_receipt_vault_invalid",
    );
  expect(() =>
    vault.open({ keyId: "r1", ciphertext: "x".repeat(8193) }, binding),
  ).toThrow("payer_receipt_vault_invalid");
});
it("rejects duplicate ids, noncanonical encoding and wrong key lengths", () => {
  expect(api.resolvePayerReceiptKeys).toBeTypeOf("function");
  const k = Buffer.alloc(32, 17).toString("base64url");
  expect(
    api.resolvePayerReceiptKeys(JSON.stringify({ r1: k })).get("r1"),
  ).toEqual(Buffer.alloc(32, 17));
  for (const raw of [
    `{"r1":"${k}","r1":"${k}"}`,
    `{"r1":"${k}","r\\u0031":"${k}"}`,
    JSON.stringify({ r1: `${k}=` }),
    JSON.stringify({ r1: "a" }),
    "[]",
  ])
    expect(() => api.resolvePayerReceiptKeys(raw)).toThrow(
      "payer_receipt_configuration_invalid",
    );
});
