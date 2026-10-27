import { expect, it, vi } from "vitest";
import {
  createClientSessionService,
  type ClientSessionRepository,
} from "./client-session-service.js";

const proof = {
  userId: "00000000-0000-4000-8000-000000000123",
  audience: "ii-tonya-client" as const,
  scope: "client_session:create" as const,
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  replayDigest: `hmac-sha256:v1:${"c".repeat(64)}` as const,
};
const setup = (bookingGrantsEnabled?: boolean, valid = true) => {
  const issue = vi.fn<ClientSessionRepository["issue"]>(async () => ({
    kind: "issued",
    expiresAt: proof.expiresAt,
  }));
  const options = {
    verifier: { verify: async () => (valid ? proof : null) },
    sessions: { issue },
    generateToken: () => `cs1.${"a".repeat(43)}` as const,
    digestToken: () => `sha256:${"b".repeat(64)}` as const,
    ...(bookingGrantsEnabled === undefined ? {} : { bookingGrantsEnabled }),
  };
  return { issue, service: createClientSessionService(options) };
};

it.each([undefined, false])(
  "does not mint a grant when capability is %s",
  async (flag) => {
    const s = setup(flag);
    expect((await s.service.issue("verified-proof")).kind).toBe("issued");
    expect(s.issue.mock.calls[0]?.[0]).not.toHaveProperty("bookingGrant");
  },
);
it("atomically requests an explicit grant only through server configuration", async () => {
  const s = setup(true);
  expect(await s.service.issue("verified-proof")).toMatchObject({
    kind: "issued",
    scope: "client_catalog:read",
  });
  expect(s.issue.mock.calls[0]?.[0]).toMatchObject({
    bookingGrant: true,
    userId: proof.userId,
  });
});
it("does not mint a grant when identity verification is denied", async () => {
  const s = setup(true, false);
  expect(await s.service.issue("bad-proof")).toEqual({ kind: "unauthorized" });
  expect(s.issue).not.toHaveBeenCalled();
});
