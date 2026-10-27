import { expect, it, vi } from "vitest";
import { PrivacyClient } from "./privacy-client.js";
it("keeps the same pre-generated receipt after an uncertain write and sends it only in JSON", async () => {
  const bodies: string[] = [];
  const request = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      if (url === "/v1/browser/session")
        return new Response(
          JSON.stringify({
            authenticated: true,
            csrfToken: "csrf",
            erasureAvailable: true,
          }),
        );
      bodies.push(String(init?.body));
      expect(String(url)).not.toContain("er1.");
      if (bodies.length === 1) throw new Error("lost response");
      return new Response(
        JSON.stringify({
          requestId: "r",
          requestedAt: "2026-10-09T00:00:00.000Z",
          stage: "awaiting_execution",
          retainedFacts: null,
        }),
      );
    },
  );
  const client = new PrivacyClient(request as typeof fetch);
  await client.probe();
  const token = client.prepareErasureReceipt();
  expect(token).toMatch(/^er1\.[A-Za-z0-9_-]{43}$/u);
  await expect(client.requestErasure()).rejects.toThrow("lost response");
  expect(client.prepareErasureReceipt()).toBe(token);
  expect((await client.requestErasure()).stage).toBe("awaiting_execution");
  expect(bodies).toEqual([
    JSON.stringify({ receiptToken: token, confirmed: true }),
    JSON.stringify({ receiptToken: token, confirmed: true }),
  ]);
});
it("reads a receipt without login and clears generated request credentials on authority change", async () => {
  const client = new PrivacyClient(
    async () => new Response(JSON.stringify({ stage: "awaiting_execution" })),
  );
  expect((await client.readErasureReceipt(`er1.${"A".repeat(43)}`)).stage).toBe(
    "awaiting_execution",
  );
  expect(() => client.prepareErasureReceipt()).toThrow();
});
