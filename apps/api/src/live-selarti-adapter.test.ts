import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LiveSelartiAdapter } from "./live-selarti-adapter.js";
import type { SelartiRestFetch } from "@ii-tonya/integrations";

const secret = "synthe" + "tic-selarti-webhook-secret-000000";
const base = {
  apiKey: "synthe" + "tic-key",
  webhookSecret: secret,
  companyId: "company",
  taskId: "task",
  aiId: "ai",
  nowEpochSeconds: () => 1_800_000_000,
};
const body = Buffer.from(
  JSON.stringify({
    wh_type: "all_messages",
    channel_id: "ch",
    company_id: "company",
    external_chat_id: "chat-1",
    message_id: "m-1",
    message_text: "hi",
    message_type: "client",
    task_id: "task",
    thread_id: "t-1",
    occurred_at: "2027-01-15T08:00:00.000Z",
  }),
);
const sign = (ts: string, raw: Uint8Array, key = secret) =>
  createHmac("sha256", key).update(`${ts}.`).update(raw).digest("hex");
const headers = (ts = "1800000000", sig = sign(ts, body)) => ({
  "content-type": "application/json",
  "x-selarti-timestamp": ts,
  "x-selarti-signature": sig,
});

/** Mocked Selarti HTTP: auth, get_task, get_ai, send_message_external. */
function network(send: () => Response | Promise<Response>) {
  const ok = (response: unknown) =>
    Response.json({ status: "success", response });
  return vi.fn<SelartiRestFetch>(async (url) => {
    const path = new URL(url).pathname.split("/").at(-1);
    if (path === "auth")
      return Response.json({
        status: "success",
        response: {
          user: { active_company: "company" },
          token: "synthe" + "tic-token",
          user_id: "u",
          expires: 1,
        },
      });
    if (path === "get_task")
      return ok({ task: [{ _id: "task", company: "company", AI: "ai" }] });
    if (path === "get_ai")
      return ok({ ai: [{ _id: "ai", company: "company" }] });
    if (path === "send_message_external") return send();
    throw new Error(`unexpected ${path}`);
  });
}

const sendOk = () =>
  Response.json({
    status: "success",
    response: {
      thread: {
        _id: "thread-9",
        task: "task",
        company: "company",
        chat_id: "chat-1",
      },
    },
  });
const command = {
  idempotencyKey: "idem-1",
  channelUserId: "chat-1",
  text: "Hello",
};

describe("LiveSelartiAdapter webhook", () => {
  it("accepts a correctly signed fresh all_messages webhook", async () => {
    const adapter = new LiveSelartiAdapter(base);
    await expect(
      adapter.decodeVerifiedWebhook(body, headers()),
    ).resolves.toMatchObject({
      kind: "inbound_message",
      channelUserId: "chat-1",
      providerMessageId: "m-1",
      text: "hi",
    });
  });

  it.each([
    [
      "bad signature",
      headers(
        "1800000000",
        sign("1800000000", body, "other-secret-value-0000"),
      ),
    ],
    ["stale timestamp", headers("1799990000", sign("1799990000", body))],
    [
      "missing signature",
      {
        "content-type": "application/json",
        "x-selarti-timestamp": "1800000000",
      },
    ],
  ])("rejects %s", async (_name, h) => {
    const adapter = new LiveSelartiAdapter(base);
    await expect(adapter.decodeVerifiedWebhook(body, h)).rejects.toThrow(
      "webhook_auth_rejected",
    );
  });
});

describe("LiveSelartiAdapter send", () => {
  it("maps accepted send to applied via the real REST client", async () => {
    const fetch = network(sendOk);
    const adapter = new LiveSelartiAdapter({ ...base, fetch });
    await expect(adapter.sendMessage(command)).resolves.toEqual({
      kind: "applied",
      providerOperationId: "thread-9",
    });
    const send = fetch.mock.calls.find(([url]) =>
      url.endsWith("send_message_external"),
    );
    expect(send?.[0].startsWith("https://selarti.com/")).toBe(true);
    expect(send?.[1].method).toBe("POST");
  });

  it("maps a 5xx after write to unknown_outcome with the idempotency key", async () => {
    const adapter = new LiveSelartiAdapter({
      ...base,
      fetch: network(() => new Response("x", { status: 502 })),
    });
    await expect(adapter.sendMessage(command)).resolves.toMatchObject({
      kind: "unknown_outcome",
      reconciliationKey: "idem-1",
    });
  });

  it("acquisition failure is not_applied (no message write)", async () => {
    const fetch = vi.fn<SelartiRestFetch>(
      async () => new Response("no", { status: 503 }),
    );
    const adapter = new LiveSelartiAdapter({ ...base, fetch });
    await expect(adapter.sendMessage(command)).resolves.toMatchObject({
      kind: "not_applied",
    });
    expect(
      fetch.mock.calls.some(([u]) => u.endsWith("send_message_external")),
    ).toBe(false);
  });

  it("binding mismatch is not retryable", async () => {
    const adapter = new LiveSelartiAdapter({
      ...base,
      acquire: async () => ({
        kind: "unavailable",
        code: "binding_unverified",
      }),
    });
    await expect(adapter.sendMessage(command)).resolves.toEqual({
      kind: "not_applied",
      retryable: false,
      reasonCode: "selarti_binding_unverified",
    });
  });
});
