import { describe, expect, it } from "vitest";
import {
  ExpertCodeCrypto,
  ResolvedExpertCodeKeyring,
  digestExpertCode,
  expertCodeDigestsEqual,
} from "./expert-code-crypto.js";
import { ExpertCodeCrypto as ExportedExpertCodeCrypto } from "./index.js";

describe("ExpertCodeCrypto", () => {
  it("is exported from the application package entrypoint", () => {
    expect(ExportedExpertCodeCrypto).toBe(ExpertCodeCrypto);
  });

  it("issues namespaced 128-bit codes and returns their HMAC metadata", () => {
    const keyring = new ResolvedExpertCodeKeyring({
      currentVersion: "v1",
      secretReferences: { v1: "secret://expert-code/v1" },
      resolve: () => new Uint8Array(32).fill(7),
    });
    const issued = new ExpertCodeCrypto(keyring).issue(2);

    expect(issued).toHaveLength(2);
    expect(issued[0]?.plaintext).toMatch(/^EXR_[A-Za-z0-9_-]{22,}$/u);
    expect(issued[0]?.digest).toMatch(/^hmac-sha256:v1:[0-9a-f]{64}$/u);
    expect(issued[0]?.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(issued[0]?.maskedSuffix).toMatch(/^[A-Za-z0-9_-]{6}$/u);
    expect(issued[0]?.plaintext).not.toBe(issued[1]?.plaintext);
  });

  it("retains current and previous versions without retaining resolver buffers", () => {
    const disposable = {
      v1: new Uint8Array(32).fill(1),
      v2: new Uint8Array(32).fill(2),
    };
    const keyring = new ResolvedExpertCodeKeyring({
      currentVersion: "v2",
      secretReferences: {
        v1: "secret://expert-code/v1",
        v2: "secret://expert-code/v2",
      },
      resolve: (reference) =>
        reference.endsWith("v1") ? disposable.v1 : disposable.v2,
    });

    expect(keyring.activeVersions).toEqual(["v2", "v1"]);
    expect(disposable.v1.every((value) => value === 0)).toBe(true);
    expect(disposable.v2.every((value) => value === 0)).toBe(true);

    const candidates = new ExpertCodeCrypto(keyring).digestCandidates(
      "EXR_AAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(candidates.map(({ keyVersion }) => keyVersion)).toEqual([
      "v2",
      "v1",
    ]);
  });

  it("rejects an ambiguous keyring with more than current and previous", () => {
    let resolutions = 0;
    expect(
      () =>
        new ResolvedExpertCodeKeyring({
          currentVersion: "v3",
          secretReferences: {
            v1: "secret://expert-code/v1",
            v2: "secret://expert-code/v2",
            v3: "secret://expert-code/v3",
          },
          resolve: () => {
            resolutions += 1;
            return new Uint8Array(32).fill(1);
          },
        }),
    ).toThrowError("Expert referral keyring must contain at most two versions");
    expect(resolutions).toBe(0);
  });

  it("compares digests in constant-time form and rejects unsafe input opaquely", () => {
    const key = new Uint8Array(32).fill(9);
    const digest = digestExpertCode("EXR_AAAAAAAAAAAAAAAAAAAAAA", "v1", key);
    expect(expertCodeDigestsEqual(digest, digest)).toBe(true);
    expect(expertCodeDigestsEqual(digest, digest.replace(/a/u, "b"))).toBe(
      false,
    );

    const crypto = new ExpertCodeCrypto({
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => key,
    });
    const plaintext = "NOT_AN_EXPERT_CODE_secret";
    expect(() => crypto.digestCandidates(plaintext)).toThrowError(
      "Invalid expert referral code",
    );
    try {
      crypto.digestCandidates(plaintext);
    } catch (error) {
      expect(String(error)).not.toContain(plaintext);
    }
  });

  it.each([0, 1001])("rejects issuance count %s", (count) => {
    const crypto = new ExpertCodeCrypto({
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => new Uint8Array(32).fill(3),
    });
    expect(() => crypto.issue(count)).toThrowError(
      "Expert referral batch size must be between 1 and 1000",
    );
  });
});
