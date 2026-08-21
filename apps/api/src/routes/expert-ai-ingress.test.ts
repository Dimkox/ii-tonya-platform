import { describe, expect, it, vi } from "vitest";
import { buildTestApp } from "../app.js";
import type {
  ExpertAiRequestLedger,
  ExpertAiTransportOutcome,
} from "./expert-ai-ingress.js";

const principal = {
  authenticated: true as const,
  userId: "00000000-0000-4000-8000-000000000001",
  expertId: "00000000-0000-4000-8000-000000000002",
};
const features = {
  expertReferral: false,
  expertResidencyBilling: false,
  expertAiIngress: true,
};

const requestLedger = (): ExpertAiRequestLedger => {
  const receipts = new Map<
    string,
    { digest: string; outcome?: ExpertAiTransportOutcome }
  >();
  const claims = new Map<string, string>();
  return {
    async claim(input: {
      expertId: string;
      idempotencyKey: string;
      requestDigest: string;
    }) {
      const key = `${input.expertId}:${input.idempotencyKey}`;
      const receipt = receipts.get(key);
      if (receipt !== undefined) {
        if (receipt.digest !== input.requestDigest)
          return { kind: "conflict" as const };
        return receipt.outcome === undefined
          ? { kind: "busy" as const }
          : { kind: "replay" as const, outcome: receipt.outcome };
      }
      const claimId = `claim:${key}`;
      receipts.set(key, { digest: input.requestDigest });
      claims.set(claimId, key);
      return { kind: "claimed" as const, claimId };
    },
    async complete(
      claimId: string,
      outcome: ExpertAiTransportOutcome,
    ) {
      const key = claims.get(claimId)!;
      const receipt = receipts.get(key)!;
      receipts.set(key, { ...receipt, outcome });
    },
    async fail(claimId: string) {
      const key = claims.get(claimId);
      if (key !== undefined) receipts.delete(key);
    },
  };
};

describe("expert AI HTTP transport", () => {
  it("stays absent while disabled", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/assistant/messages",
      payload: { text: "Покажи баланс", locale: "ru-RU" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("reauthenticates each request and forwards bounded server metadata", async () => {
    const resolve = vi.fn(async () => principal);
    const handle = vi.fn(async () => ({
      kind: "completed" as const,
      proposalKind: "view_referral_summary" as const,
      result: { private: "must-not-cross-transport" },
    }));
    const app = await buildTestApp({
      features,
      expertAiIngress: { handle },
      expertAiPrincipal: { resolve },
      expertAiRequests: requestLedger(),
    });
    const request = () =>
      app.inject({
        method: "POST",
        url: "/v1/expert/assistant/messages",
        headers: {
          authorization: `Bearer ${"A".repeat(32)}`,
          "idempotency-key": "assistant-request-0001",
          "x-correlation-id": "correlation-0001",
        },
        payload: {
          text: "Покажи баланс",
          locale: "ru-RU",
          tariffVersionId: "00000000-0000-4000-8000-000000000101",
        },
      });

    const first = await request();
    const second = await request();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      status: "completed",
      proposalKind: "view_referral_summary",
    });
    expect(second.json()).toEqual(first.json());
    expect(first.body).not.toContain("must-not-cross-transport");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenNthCalledWith(1, {
      principal,
      text: "Покажи баланс",
      locale: "ru-RU",
      tariffVersionId: "00000000-0000-4000-8000-000000000101",
      idempotencyKey: "assistant-request-0001",
      correlationId: "correlation-0001",
    });
    await app.close();
  });

  it("rejects conflicting reuse of an expert-scoped idempotency key", async () => {
    const handle = vi.fn(async () => ({
      kind: "completed" as const,
      proposalKind: "view_referral_summary" as const,
      result: {},
    }));
    const app = await buildTestApp({
      features,
      expertAiIngress: { handle },
      expertAiPrincipal: { resolve: async () => principal },
      expertAiRequests: requestLedger(),
    });
    const headers = {
      authorization: `Bearer ${"A".repeat(32)}`,
      "idempotency-key": "assistant-request-0004",
    };
    await app.inject({
      method: "POST",
      url: "/v1/expert/assistant/messages",
      headers,
      payload: { text: "Баланс", locale: "ru-RU" },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/expert/assistant/messages",
      headers,
      payload: { text: "Другой запрос", locale: "ru-RU" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "idempotency_conflict" });
    expect(handle).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("keeps a successful dispatch claimed when durable completion is ambiguous", async () => {
    let claimed = false;
    const fail = vi.fn(async () => undefined);
    const handle = vi.fn(async () => ({
      kind: "completed" as const,
      proposalKind: "view_referral_summary" as const,
      result: {},
    }));
    const app = await buildTestApp({
      features,
      expertAiIngress: { handle },
      expertAiPrincipal: { resolve: async () => principal },
      expertAiRequests: {
        claim: async () => {
          if (claimed) return { kind: "busy" as const };
          claimed = true;
          return { kind: "claimed" as const, claimId: "claim-ambiguous" };
        },
        complete: async () => {
          throw new Error("receipt completion unavailable");
        },
        fail,
      },
    });
    const request = () =>
      app.inject({
        method: "POST",
        url: "/v1/expert/assistant/messages",
        headers: {
          authorization: `Bearer ${"A".repeat(32)}`,
          "idempotency-key": "assistant-request-0005",
        },
        payload: { text: "Баланс", locale: "ru-RU" },
      });
    const first = await request();
    const second = await request();
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ error: "unavailable" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "request_in_progress" });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects missing authentication, malformed metadata, and expanded bodies before dispatch", async () => {
    const handle = vi.fn(async () => ({ kind: "unavailable" as const }));
    const app = await buildTestApp({
      features,
      expertAiIngress: { handle },
      expertAiPrincipal: { resolve: async () => null },
      expertAiRequests: requestLedger(),
    });
    const common = {
      method: "POST" as const,
      url: "/v1/expert/assistant/messages",
      payload: { text: "Баланс", locale: "ru-RU" },
    };
    expect((await app.inject(common)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          ...common,
          headers: {
            authorization: `Bearer ${"A".repeat(32)}`,
            "idempotency-key": "short",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          ...common,
          headers: {
            authorization: `Bearer ${"A".repeat(32)}`,
            "idempotency-key": "assistant-request-0002",
          },
          payload: { ...common.payload, extraAuthority: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(handle).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    [{ kind: "forbidden" as const }, 403, { error: "forbidden" }],
    [{ kind: "disabled" as const }, 503, { error: "feature_disabled" }],
    [{ kind: "unavailable" as const }, 503, { error: "unavailable" }],
    [
      { kind: "rejected" as const, reasonCode: "invalid_shape" as const },
      422,
      { error: "proposal_rejected", reasonCode: "invalid_shape" },
    ],
  ])("maps the closed ingress outcome %#", async (result, status, body) => {
    const app = await buildTestApp({
      features,
      expertAiIngress: { handle: async () => result },
      expertAiPrincipal: { resolve: async () => principal },
      expertAiRequests: requestLedger(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/assistant/messages",
      headers: {
        authorization: `Bearer ${"A".repeat(32)}`,
        "idempotency-key": "assistant-request-0003",
      },
      payload: { text: "Баланс", locale: "ru-RU" },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual(body);
    await app.close();
  });
});
