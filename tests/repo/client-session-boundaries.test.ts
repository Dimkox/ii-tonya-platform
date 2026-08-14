import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("client session production boundaries", () => {
  it("exports no accepted-proof stub or provider implementation", () => {
    const production = [
      "packages/application/src/client-session-service.ts",
      "apps/api/src/client-proof-verifier-gate.ts",
      "apps/api/src/server.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(production).not.toMatch(/approvedProofVerifier|allow.?all|test.?proof|providerSubject/iu);
  });

  it("keeps provider, ledger, reservation, booking and payment imports outside the session slice", () => {
    for (const path of [
      "packages/application/src/client-session-service.ts",
      "packages/db/src/repositories/client-session-repository.ts",
      "apps/api/src/routes/client-sessions.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/planerka|provider|ledger|reservation|booking|payment/iu);
    }
  });
});
