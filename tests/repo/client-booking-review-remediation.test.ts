import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("client booking review lock and adapter closure", () => {
  it("reads the database clock only after the protected choice lock", () => {
    const source = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );
    const reserve = source.slice(
      source.indexOf("async reserveProtectedChoice"),
      source.indexOf("cancelOwnedByHandle"),
    );
    expect(reserve.indexOf("choice:${command.choiceDigest}")).toBeLessThan(
      reserve.indexOf('clock_timestamp() as "databaseNow"'),
    );
  });

  it("uses choice then outbox ordering in privacy and retention", () => {
    const privacy = readFileSync(
      "packages/db/src/repositories/privacy-repository.ts",
      "utf8",
    ).slice(
      readFileSync(
        "packages/db/src/repositories/privacy-repository.ts",
        "utf8",
      ).indexOf("startErasureWithVerifiedManifests"),
    );
    expect(privacy.indexOf("'choice:' || c.choice_digest")).toBeLessThan(
      privacy.indexOf("from integration_outbox o"),
    );

    const retention = readFileSync(
      "packages/db/src/repositories/client-catalog-repository.ts",
      "utf8",
    ).slice(
      readFileSync(
        "packages/db/src/repositories/client-catalog-repository.ts",
        "utf8",
      ).indexOf("expireDue"),
    );
    expect(retention.indexOf("await lockCatalogChoices")).toBeLessThan(
      retention.indexOf("for update of o skip locked"),
    );
  });

  it("rejects duplicate protected digests before database insertion", () => {
    const source = readFileSync(
      "packages/db/src/repositories/client-catalog-repository.ts",
      "utf8",
    );
    expect(source).toContain(
      "new Set(protectedDigests).size !== protectedDigests.length",
    );
  });
});
