import { expect, it, vi } from "vitest";
import { PrivacyClient } from "./privacy-client.js";
it("calls the default browser transport without binding fetch to PrivacyClient", async () => {
  // Window.fetch accepts Window/undefined, but rejects a PrivacyClient receiver.
  // Injected arrow-function transports cannot reproduce this Web IDL boundary.
  vi.stubGlobal(
    "fetch",
    async function (this: unknown, url: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      if (url !== "/v1/browser/session")
        return new Response(null, { status: 404 });
      return Response.json({
        available: true,
        authenticated: false,
        csrfToken: "csrf",
        erasureAvailable: false,
      });
    },
  );
  try {
    await expect(new PrivacyClient().probe()).resolves.toMatchObject({
      available: true,
      authenticated: false,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
const document = {
  id: "doc-1",
  documentKey: "consent.client_profile",
  title: "Exact",
  body: "<script>never execute</script>\nExact",
  version: 7,
  textSha256: "a".repeat(64),
};
function fixture() {
  const writes: { path: string; body: unknown }[] = [];
  let fail = "";
  const request: typeof fetch = async (url, init) => {
    const path = String(url);
    if (init?.method && init.method !== "GET")
      writes.push({
        path,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
    if (fail && path.includes(fail)) return new Response("{}", { status: 503 });
    const body = path.endsWith("session")
      ? { authenticated: true, available: true, csrfToken: "csrf" }
      : path.endsWith("presentations")
        ? { token: "presentation-token", document, policyVersion: "profile-v7" }
        : path.endsWith("consents")
          ? {
              consents: [
                {
                  purpose: "client_profile",
                  inForce: true,
                  policyVersion: "profile-v7",
                },
                {
                  purpose: "follow_up",
                  inForce: true,
                  policyVersion: "follow-up-v2",
                },
              ],
            }
          : { own: "export" };
    return Response.json(body);
  };
  return {
    client: new PrivacyClient(request),
    writes,
    fail: (s: string) => {
      fail = s;
    },
  };
}
it("opening a document never grants and explicit decision uses exactly the presented server version", async () => {
  const f = fixture();
  await f.client.probe();
  const shown = await f.client.present("client_profile");
  expect(shown.document).toEqual(document);
  expect(f.writes.map((w) => w.path)).toEqual([
    "/v1/browser/privacy/presentations",
  ]);
  await f.client.decide("client_profile", "granted");
  expect(f.writes[1]).toEqual({
    path: "/v1/browser/privacy/decisions",
    body: {
      token: "presentation-token",
      purpose: "client_profile",
      policyVersion: "profile-v7",
      decision: "granted",
    },
  });
});
it("requires a displayed document and calls actual withdrawal for active grants", async () => {
  const f = fixture();
  await f.client.probe();
  await expect(f.client.decide("client_profile", "granted")).rejects.toThrow();
  await f.client.list();
  await f.client.withdraw("client_profile");
  expect(f.writes[0]).toEqual({
    path: "/v1/browser/privacy/consents/withdraw",
    body: { purpose: "client_profile", policyVersion: "profile-v7" },
  });
});
it("reports failed all-withdraw operations, API failures, exports and logout", async () => {
  const f = fixture();
  await f.client.probe();
  await f.client.list();
  f.fail("withdraw");
  expect(await f.client.withdrawAll()).toMatchObject({
    withdrawn: [],
    failed: ["client_profile", "follow_up"],
  });
  f.fail("presentations");
  await expect(f.client.present("client_profile")).rejects.toThrow();
  f.fail("");
  expect(await f.client.export()).toEqual({ own: "export" });
  await f.client.logout();
  expect(f.client.authenticated).toBe(false);
  await expect(f.client.list()).rejects.toThrow();
});
it("reprobes CSRF and authoritative state after 403 without repeating a mutation", async () => {
  const calls: string[] = [];
  let probes = 0;
  const client = new PrivacyClient(async (url, init) => {
    const key = `${init?.method} ${url}`;
    calls.push(key);
    if (String(url).endsWith("session"))
      return Response.json({
        authenticated: true,
        csrfToken: `csrf-${++probes}`,
      });
    if (String(url).endsWith("consents"))
      return Response.json({ consents: [] });
    if (String(url).endsWith("presentations"))
      return Response.json({
        token: "token",
        policyVersion: "profile-v7",
        document,
      });
    return new Response(null, { status: 403 });
  });
  await client.probe();
  await client.present("client_profile");
  await expect(
    client.decide("client_profile", "granted"),
  ).rejects.toMatchObject({ status: 403 });
  expect(probes).toBe(2);
  expect(
    calls.filter((c) => c === "POST /v1/browser/privacy/decisions"),
  ).toHaveLength(1);
  expect(calls).toContain("GET /v1/browser/privacy/consents");
  await expect(client.decide("client_profile", "granted")).rejects.toThrow(
    "document_decision_unavailable",
  );
});
it("withdraw-all refreshes before and after and reports concurrent grants and partial uncertainty", async () => {
  let reads = 0;
  const writes: unknown[] = [];
  const client = new PrivacyClient(async (url, init) => {
    if (String(url).endsWith("session"))
      return Response.json({ authenticated: true, csrfToken: "csrf" });
    if (String(url).endsWith("consents")) {
      reads++;
      return Response.json({
        consents:
          reads === 1
            ? [
                {
                  purpose: "client_profile",
                  policyVersion: "profile-v1",
                  inForce: true,
                },
                {
                  purpose: "follow_up",
                  policyVersion: "follow-up-v1",
                  inForce: true,
                },
              ]
            : [
                {
                  purpose: "client_messaging",
                  policyVersion: "messaging-v1",
                  inForce: true,
                },
              ],
      });
    }
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({}, { status: writes.length === 1 ? 200 : 503 });
  });
  await client.probe();
  expect(await client.withdrawAll()).toEqual({
    withdrawn: ["client_profile"],
    failed: ["follow_up"],
    remainingActive: ["client_messaging"],
    verified: true,
  });
  expect(reads).toBe(2);
  expect(writes).toHaveLength(2);
});
it("preserves confirmed withdrawals if the final authoritative refresh fails", async () => {
  let reads = 0;
  const client = new PrivacyClient(async (url) => {
    if (String(url).endsWith("session"))
      return Response.json({ authenticated: true });
    if (String(url).endsWith("consents"))
      return ++reads === 1
        ? Response.json({
            consents: [
              {
                purpose: "client_profile",
                policyVersion: "profile-v1",
                inForce: true,
              },
            ],
          })
        : new Response(null, { status: 503 });
    return new Response(null, { status: 204 });
  });
  await client.probe();
  expect(await client.withdrawAll()).toEqual({
    withdrawn: ["client_profile"],
    failed: [],
    remainingActive: [],
    verified: false,
  });
});
it("does not restore authenticated state from a probe that arrives after logout", async () => {
  const late = Promise.withResolvers<Response>();
  const client = new PrivacyClient(async (_url, init) =>
    init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : late.promise,
  );
  const probe = client.probe();
  const rejected = expect(probe).rejects.toThrow();
  await client.logout();
  late.resolve(Response.json({ authenticated: true, csrfToken: "stale" }));
  await rejected;
  expect(client.authenticated).toBe(false);
});
it("bounds fetch and body parsing even when a transport ignores cancellation", async () => {
  vi.useFakeTimers();
  try {
    const client = new PrivacyClient(
      async () => new Promise<Response>(() => {}),
      { timeoutMs: 25 },
    );
    const probe = client.probe();
    const rejected = expect(probe).rejects.toThrow("privacy_request_timeout");
    await vi.advanceTimersByTimeAsync(26);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});
