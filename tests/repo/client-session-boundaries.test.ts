import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { preProcessFile } from "typescript";

describe("client session production boundaries", () => {
  it("exports no accepted-proof stub or provider implementation", () => {
    const production = [
      "packages/application/src/client-session-service.ts",
      "apps/api/src/client-proof-verifier-gate.ts",
      "apps/api/src/server.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(production).not.toMatch(
      /approvedProofVerifier|allowAll|allow_all|testProof|test_proof|providerSubject/iu,
    );
  });

  it("keeps provider, ledger, reservation, booking and payment imports outside the session slice", () => {
    for (const path of [
      "packages/application/src/client-session-service.ts",
      "packages/db/src/repositories/client-session-repository.ts",
      "apps/api/src/routes/client-sessions.ts",
    ]) {
      const imports = preProcessFile(
        readFileSync(path, "utf8"),
        true,
        true,
      ).importedFiles.map(({ fileName }) => fileName);
      expect(imports, path).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /(?:planerka|provider|ledger|reservation|booking|payment)/iu,
          ),
        ]),
      );
    }
  });
});
