import { createHash, createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { createTelegramClientProofVerifier } from "./telegram-client-proof.js";

const botToken = "123456789:" + "T".repeat(35);
const now = Date.UTC(2026, 9, 4, 12);
const userId = "00000000-0000-4000-8000-000000000001";
function proof(mode: "mini" | "widget", changes: Record<string, string> = {}) {
  const fields = {
    auth_date: String(now / 1000),
    ...(mode === "mini"
      ? { user: '{"id":42,"first_name":"Synthetic"}' }
      : { id: "42", first_name: "Synthetic" }),
    ...changes,
  };
  const entries = Object.entries(fields).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const key =
    mode === "mini"
      ? createHmac("sha256", "WebAppData").update(botToken).digest()
      : createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", key)
    .update(entries.map(([k, v]) => `${k}=${v}`).join("\n"))
    .digest("hex");
  return `${mode}:${new URLSearchParams([...entries, ["hash", hash]])}`;
}
const input = (identityProof: string) => ({
  identityProof,
  expectedAudience: "ii-tonya-client" as const,
  expectedScope: "client_session:create" as const,
  signal: new AbortController().signal,
});
function verifier(
  resolve = async (externalId: string) => (externalId === "42" ? userId : null),
) {
  return createTelegramClientProofVerifier({
    botToken,
    resolveIdentity: resolve,
    now: () => now,
    widgetEnabled: true,
  });
}

it.each(["mini", "widget"] as const)(
  "authenticates only signed %s identity and returns bounded server claims",
  async (mode) => {
    expect(await verifier().verify(input(proof(mode)))).toEqual({
      userId,
      audience: "ii-tonya-client",
      scope: "client_session:create",
      expiresAt: new Date(now + 300_000),
      replayDigest: expect.stringMatching(/^hmac-sha256:v1:[0-9a-f]{64}$/),
    });
  },
);
it("rejects forgery, other users, stale/future timestamps, duplicate fields, oversize and wrong audience", async () => {
  for (const raw of [
    proof("mini").replace("42", "43"),
    proof("widget", { id: "43" }),
    proof("mini", { auth_date: String(now / 1000 - 301) }),
    proof("mini", { auth_date: String(now / 1000 + 31) }),
    proof("widget") + "&id=42",
    "mini:" + "x".repeat(6144),
    proof("mini", { user: '{"id":42,"id":43}' }),
    proof("widget", { userId }),
  ]) {
    expect(await verifier().verify(input(raw))).toBeNull();
  }
  expect(
    await verifier().verify({
      ...input(proof("mini")),
      expectedAudience: "other" as "ii-tonya-client",
    }),
  ).toBeNull();
});
it.each(["mini", "widget"] as const)(
  "rejects a forged %s hash while identity 42 remains resolvable",
  async (mode) => {
    const valid = proof(mode);
    const params = new URLSearchParams(valid.slice(mode.length + 1));
    const hash = params.get("hash")!;
    params.set("hash", (hash[0] === "0" ? "1" : "0") + hash.slice(1));
    expect(await verifier().verify(input(valid))).toMatchObject({ userId });
    expect(await verifier().verify(input(`${mode}:${params}`))).toBeNull();
  },
);
it("uses canonical proof digest so field reordering cannot evade replay receipts", async () => {
  const raw = proof("widget");
  const reordered = "widget:" + raw.slice(7).split("&").reverse().join("&");
  const first = await verifier().verify(input(raw));
  expect(first).not.toBeNull();
  expect((await verifier().verify(input(reordered)))?.replayDigest).toBe(
    first?.replayDigest,
  );
});
it("fails closed for ambiguity, disabled widget and cancellation", async () => {
  expect(
    await verifier(async () => null).verify(input(proof("mini"))),
  ).toBeNull();
  const disabled = createTelegramClientProofVerifier({
    botToken,
    resolveIdentity: async () => userId,
    now: () => now,
    widgetEnabled: false,
  });
  expect(await disabled.verify(input(proof("widget")))).toBeNull();
  expect(
    await disabled.verify({
      ...input(proof("mini")),
      signal: AbortSignal.abort(),
    }),
  ).toBeNull();
});
