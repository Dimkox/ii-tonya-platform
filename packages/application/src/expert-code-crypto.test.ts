import { describe, expect, it } from "vitest";
import {
  ExpertCodeCrypto,
  digestExpertCode,
  type ExpertCodeKeyring,
} from "./expert-code-crypto.js";

const keyring: ExpertCodeKeyring = {
  currentVersion: "v2",
  versions: ["v2", "v1"],
  key(version) {
    if (version === "v2") return new Uint8Array(32).fill(2);
    if (version === "v1") return new Uint8Array(32).fill(1);
    throw new Error("unknown_key_version");
  },
};

describe("expert referral code crypto", () => {
  it("issues 128-bit namespaced codes and returns only keyed digests for persistence", () => {
    const crypto = new ExpertCodeCrypto(keyring);

    const issued = crypto.issue(2);

    expect(issued).toHaveLength(2);
    expect(issued[0]?.plaintext).toMatch(/^EXR_[A-Za-z0-9_-]{22}$/u);
    expect(issued[0]?.digest).toMatch(/^hmac-sha256:v2:[0-9a-f]{64}$/u);
    expect(issued[0]?.maskedSuffix).toMatch(/^…[A-Za-z0-9_-]{4}$/u);
    expect(issued[0]?.keyVersion).toBe(2);
    expect(issued[1]?.plaintext).not.toBe(issued[0]?.plaintext);
    expect(
      JSON.stringify(
        issued.map(({ digest, keyVersion, maskedSuffix }) => ({
          digest,
          keyVersion,
          maskedSuffix,
        })),
      ),
    ).not.toContain(issued[0]?.plaintext);
  });

  it("verifies a stored digest with its version and supports retained rotation keys", () => {
    const crypto = new ExpertCodeCrypto(keyring);
    const code = "EXR_AAAAAAAAAAAAAAAAAAAAAA";
    const oldDigest = digestExpertCode(code, "v1", keyring.key("v1"));

    expect(crypto.verify(code, oldDigest, 1)).toBe(true);
    expect(crypto.verify("EXR_BBBBBBBBBBBBBBBBBBBBBB", oldDigest, 1)).toBe(
      false,
    );
    expect(crypto.digestCandidates(code)).toEqual([
      {
        keyVersion: 2,
        digest: digestExpertCode(code, "v2", keyring.key("v2")),
      },
      { keyVersion: 1, digest: oldDigest },
    ]);
  });

  it("rejects malformed codes, unknown versions, and out-of-range batch sizes", () => {
    const crypto = new ExpertCodeCrypto(keyring);

    expect(() => crypto.issue(0)).toThrow("invalid_expert_code_batch_size");
    expect(() => crypto.issue(1001)).toThrow("invalid_expert_code_batch_size");
    expect(() => crypto.digestCandidates("client_coupon_500")).toThrow(
      "invalid_expert_code",
    );
    expect(() =>
      crypto.verify("EXR_AAAAAAAAAAAAAAAAAAAAAA", "not-a-digest", 9),
    ).toThrow("unknown_key_version");
  });
});
