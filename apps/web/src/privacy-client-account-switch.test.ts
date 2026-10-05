import { expect, it } from "vitest";
import { PrivacyClient, type ConsentState } from "./privacy-client.js";

const aStates: ConsentState[] = [
  { purpose: "client_profile", inForce: true, policyVersion: "profile-v1" },
  { purpose: "follow_up", inForce: true, policyVersion: "follow-up-v1" },
  { purpose: "client_messaging", inForce: true, policyVersion: "messaging-v1" },
];
const bStates: ConsentState[] = aStates.map((state) => ({
  ...state,
  policyVersion: state.policyVersion.replace("v1", "v2"),
}));
const session = (account: string) =>
  Response.json({
    available: true,
    authenticated: true,
    csrfToken: `csrf-${account}`,
    privacyAvailable: true,
    erasureAvailable: false,
  });

it.each([
  { status: 403, failAt: 0, purposes: 2 },
  { status: 403, failAt: 1, purposes: 3 },
  { status: 401, failAt: 1, purposes: 3 },
])(
  "stops A's bulk at $status on request $failAt without withdrawing B's remaining purposes",
  async ({ status, failAt, purposes }) => {
    let account = "A";
    const writes: { account: string; csrf: string | null; purpose: string }[] =
      [];
    let bReads = 0;
    const client = new PrivacyClient(async (url, init) => {
      if (String(url).endsWith("/session")) return session(account);
      if (String(url).endsWith("/consents")) {
        if (account === "B") bReads++;
        return Response.json({
          consents: account === "A" ? aStates.slice(0, purposes) : bStates,
        });
      }
      if (String(url).endsWith("/consents/withdraw")) {
        writes.push({
          account,
          csrf: new Headers(init?.headers).get("x-csrf-token"),
          purpose: JSON.parse(String(init?.body)).purpose,
        });
        if (writes.length - 1 === failAt) {
          account = "B";
          return Response.json({}, { status });
        }
        return new Response(null, { status: 204 });
      }
      throw new Error("unexpected transport path");
    });
    await client.probe();
    const result = await client.withdrawAll();
    expect(writes).toEqual(
      failAt === 0
        ? [{ account: "A", csrf: "csrf-A", purpose: "client_profile" }]
        : [
            { account: "A", csrf: "csrf-A", purpose: "client_profile" },
            { account: "A", csrf: "csrf-A", purpose: "follow_up" },
          ],
    );
    expect(result).toEqual({
      withdrawn: failAt === 0 ? [] : ["client_profile"],
      failed: failAt === 0 ? ["client_profile"] : ["follow_up"],
      remainingActive: [],
      verified: false,
      interrupted: "session_changed",
      notAttempted: failAt === 0 ? ["follow_up"] : ["client_messaging"],
    });
    // The 403 recovery may read B once for display, never again as A's final snapshot.
    expect(bReads).toBe(status === 403 ? 1 : 0);
    expect(client.authenticated).toBe(status === 403);
  },
);

it("stops before the first write when a probe changes session during the initial authoritative read", async () => {
  let account = "A",
    writes = 0;
  const started = Promise.withResolvers<void>();
  const list = Promise.withResolvers<Response>();
  const client = new PrivacyClient(async (url) => {
    if (String(url).endsWith("/session")) return session(account);
    if (String(url).endsWith("/consents")) {
      started.resolve();
      return list.promise;
    }
    writes++;
    return new Response(null, { status: 204 });
  });
  await client.probe();
  const bulk = client.withdrawAll();
  await started.promise;
  account = "B";
  await client.probe();
  list.resolve(Response.json({ consents: aStates }));
  expect(await bulk).toMatchObject({
    withdrawn: [],
    failed: [],
    remainingActive: [],
    verified: false,
    interrupted: "session_changed",
  });
  expect(writes).toBe(0);
});

it("preserves prior A receipts but stops remaining purposes after a logout/login epoch change", async () => {
  let account = "A";
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const writes: string[] = [];
  const client = new PrivacyClient(async (url, init) => {
    if (String(url).endsWith("/session"))
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : session(account);
    if (String(url).endsWith("/consents"))
      return Response.json({ consents: account === "A" ? aStates : bStates });
    writes.push(account);
    if (writes.length === 2) {
      started.resolve();
      return pending.promise;
    }
    return new Response(null, { status: 204 });
  });
  await client.probe();
  const bulk = client.withdrawAll();
  await started.promise;
  await client.logout();
  account = "B";
  await client.probe();
  pending.resolve(new Response(null, { status: 204 }));
  expect(await bulk).toEqual({
    withdrawn: ["client_profile"],
    failed: ["follow_up"],
    remainingActive: [],
    verified: false,
    interrupted: "session_changed",
    notAttempted: ["client_messaging"],
  });
  expect(writes).toEqual(["A", "A"]);
});

it("does not merge B's final snapshot with A's confirmed receipts", async () => {
  let account = "A",
    reads = 0,
    writes = 0;
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const client = new PrivacyClient(async (url) => {
    if (String(url).endsWith("/session")) return session(account);
    if (String(url).endsWith("/consents")) {
      if (++reads === 2) {
        started.resolve();
        return pending.promise;
      }
      return Response.json({ consents: aStates.slice(0, 1) });
    }
    writes++;
    return new Response(null, { status: 204 });
  });
  await client.probe();
  const bulk = client.withdrawAll();
  await started.promise;
  account = "B";
  await client.probe();
  pending.resolve(Response.json({ consents: bStates }));
  expect(await bulk).toEqual({
    withdrawn: ["client_profile"],
    failed: [],
    remainingActive: [],
    verified: false,
    interrupted: "session_changed",
    notAttempted: [],
  });
  expect(writes).toBe(1);
  expect(reads).toBe(2);
});

it("server-binds the final GET after a silent cookie switch without a local probe or epoch change", async () => {
  let account = "A";
  const reads: { account: string; csrf: string | null; status: number }[] = [];
  const writes: string[] = [];
  const client = new PrivacyClient(async (url, init) => {
    const csrf = new Headers(init?.headers).get("x-csrf-token");
    if (String(url).endsWith("/session")) {
      expect(csrf).toBeNull(); // Only the public probe is unbound.
      return session(account);
    }
    if (String(url).endsWith("/consents")) {
      const status = csrf === `csrf-${account}` ? 200 : 403;
      reads.push({ account, csrf, status });
      return Response.json(
        { consents: account === "A" ? aStates.slice(0, 1) : bStates },
        { status },
      );
    }
    expect(account).toBe("A");
    expect(csrf).toBe("csrf-A");
    writes.push(account);
    account = "B"; // Other tab changes cookies. Do NOT call probe here.
    return new Response(null, { status: 204 });
  });
  await client.probe();
  expect(await client.withdrawAll()).toEqual({
    withdrawn: ["client_profile"],
    failed: [],
    remainingActive: [],
    verified: false,
    interrupted: "session_changed",
    notAttempted: [],
  });
  expect(writes).toEqual(["A"]);
  expect(reads).toEqual([
    { account: "A", csrf: "csrf-A", status: 200 },
    { account: "B", csrf: "csrf-A", status: 403 },
    { account: "B", csrf: "csrf-B", status: 200 },
  ]);
  // Recovery data is not retained as authority for another action in the old bulk.
  await expect(client.withdraw("follow_up")).rejects.toThrow(
    "consent_not_active",
  );
  expect(writes).toEqual(["A"]);
});
