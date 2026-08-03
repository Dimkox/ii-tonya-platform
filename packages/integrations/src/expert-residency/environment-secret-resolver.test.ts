import { describe, expect, it } from "vitest";
import { EnvironmentExpertCodeSecretResolver } from "./environment-secret-resolver.js";

const key = Buffer.alloc(32, 7).toString("base64url");
describe("environment expert-code secret resolver", () => {
  it("resolves only the exact reference and all required versions", () => {
    const resolver = new EnvironmentExpertCodeSecretResolver({ EXPERT_REFERRAL_HMAC_KEYS_JSON: JSON.stringify({ v1: key }) });
    expect(resolver.resolve({ reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON", currentVersion: "v1", requiredVersions: ["v1"] }).activeVersions).toEqual(["v1"]);
    expect(() => resolver.resolve({ reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON", currentVersion: "v1", requiredVersions: ["v2"] })).toThrow("expert_referral_key_unavailable");
  });
  it("never includes secret contents in failures", () => {
    const secret = "not-a-valid-secret";
    const resolver = new EnvironmentExpertCodeSecretResolver({ EXPERT_REFERRAL_HMAC_KEYS_JSON: secret });
    try { resolver.resolve({ reference: "wrong", currentVersion: "v1", requiredVersions: [] }); } catch (error) {
      expect(String(error)).toBe("Error: expert_referral_key_unavailable");
      expect(String(error)).not.toContain(secret);
    }
  });
});
