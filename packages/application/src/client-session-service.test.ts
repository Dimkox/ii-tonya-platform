import { describe, expect, it, vi } from "vitest";

import {
  createClientSessionService,
  type ClientSessionRepository,
  type IdentityProofVerifier,
} from "./client-session-service.js";

const userId = "00000000-0000-4000-8000-000000000101";
const accessToken = `cs1.${"A".repeat(43)}` as const;
const tokenDigest = `sha256:${"b".repeat(64)}` as const;
const replayDigest = `hmac-sha256:v1:${"c".repeat(64)}` as const;
const expiresAt = new Date("2026-08-14T13:00:00.000Z");

const verified = () => ({
  userId,
  audience: "ii-tonya-client" as const,
  scope: "client_session:create" as const,
  expiresAt,
  replayDigest,
});

const build = (overrides: {
  verifier?: IdentityProofVerifier;
  sessions?: ClientSessionRepository;
} = {}) => {
  const issue = vi.fn<ClientSessionRepository["issue"]>(async () => ({
    kind: "issued",
    expiresAt,
  }));
  return {
    issue,
    service: createClientSessionService({
      verifier: overrides.verifier ?? { verify: async () => verified() },
      sessions: overrides.sessions ?? { issue },
      generateToken: () => accessToken,
      digestToken: () => tokenDigest,
    }),
  };
};

describe("client session issuance service", () => {
  it("returns a bearer only after the hash-only repository commits", async () => {
    const state = build();

    await expect(state.service.issue("P".repeat(32))).resolves.toEqual({
      kind: "issued",
      accessToken,
      tokenType: "Bearer",
      scope: "client_catalog:read",
      expiresAt: "2026-08-14T13:00:00.000Z",
    });
    expect(state.issue).toHaveBeenCalledWith({
      userId,
      replayDigest,
      proofExpiresAt: expiresAt,
      tokenDigest,
      scope: "client_catalog:read",
      maximumTtlMs: 3_600_000,
    });
    const persisted = JSON.stringify(state.issue.mock.calls[0]?.[0]);
    expect(persisted).not.toContain("P".repeat(32));
    expect(persisted).not.toContain(accessToken);
  });

  it.each([
    null,
    {},
    { ...verified(), extra: true },
    { ...verified(), userId: "not-a-uuid" },
    { ...verified(), audience: "other" },
    { ...verified(), scope: "other" },
    { ...verified(), expiresAt: new Date(Number.NaN) },
    { ...verified(), replayDigest: `hmac-sha256:v0:${"c".repeat(64)}` },
    { ...verified(), replayDigest: `hmac-sha256:v1:${"C".repeat(64)}` },
  ])("rejects hostile verifier output before token generation: %j", async (value) => {
    const state = build({
      verifier: { verify: async () => value as never },
    });
    await expect(state.service.issue("P".repeat(32))).resolves.toEqual({
      kind: "unauthorized",
    });
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("normalizes repository denial without returning the generated bearer", async () => {
    const state = build({ sessions: { issue: async () => ({ kind: "denied" }) } });
    await expect(state.service.issue("P".repeat(32))).resolves.toEqual({
      kind: "unauthorized",
    });
  });

  it.each(["verifier", "repository"])(
    "maps %s failure to a credential-free unavailable outcome",
    async (boundary) => {
      const secret = "nested-proof-secret";
      const state = build(
        boundary === "verifier"
          ? {
              verifier: {
                verify: async () => {
                  throw new Error(secret);
                },
              },
            }
          : {
              sessions: {
                issue: async () => {
                  throw new Error(secret);
                },
              },
            },
      );
      const result = await state.service.issue("P".repeat(32));
      expect(result).toEqual({ kind: "unavailable" });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );
});
