import { describe, expect, it } from "vitest";
import {
  EnvironmentExpertCodeSecretResolver,
  ExpertCodeSecretResolutionError,
} from "./environment-secret-resolver.js";

const encodedKey = (fill: number): string =>
  Buffer.alloc(32, fill).toString("base64url");

const request = {
  currentVersion: "v2",
  reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON" as const,
  requiredVersions: ["v1"],
};

const safeError = (
  operation: () => unknown,
): ExpertCodeSecretResolutionError => {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpertCodeSecretResolutionError);
    return error as ExpertCodeSecretResolutionError;
  }
  throw new Error("expected secret resolution failure");
};

describe("environment expert-code secret resolver", () => {
  it("resolves current and retained active versions from the exact environment reference", () => {
    const v1 = encodedKey(1);
    const v2 = encodedKey(2);
    const keyring = new EnvironmentExpertCodeSecretResolver({
      EXPERT_REFERRAL_HMAC_KEYS_JSON: JSON.stringify({ v1, v2 }),
    }).resolve(request);

    expect(keyring.currentVersion).toBe("v2");
    expect(keyring.versions).toEqual(["v2", "v1"]);
    expect(keyring.key("v1")).toEqual(new Uint8Array(32).fill(1));

    const disposable = keyring.key("v1");
    disposable.fill(0);
    expect(keyring.key("v1")).toEqual(new Uint8Array(32).fill(1));
  });

  it("rejects a non-environment reference without reading the secret source", () => {
    let reads = 0;
    const source = new Proxy(
      { EXPERT_REFERRAL_HMAC_KEYS_JSON: JSON.stringify({ v2: encodedKey(2) }) },
      {
        get(target, property, receiver) {
          reads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const error = safeError(() =>
      new EnvironmentExpertCodeSecretResolver(source).resolve({
        ...request,
        reference: "file:///tmp/keys.json" as never,
      }),
    );

    expect(error).toMatchObject({
      code: "expert_referral_key_reference_invalid",
    });
    expect(reads).toBe(0);
  });

  it.each([
    ["missing", undefined, "expert_referral_key_unavailable"],
    ["malformed JSON", "{", "expert_referral_key_map_invalid"],
    ["array", "[]", "expert_referral_key_map_invalid"],
    ["empty object", "{}", "expert_referral_key_map_invalid"],
    [
      "invalid version label",
      JSON.stringify({ v0: encodedKey(1), v2: encodedKey(2) }),
      "expert_referral_key_map_invalid",
    ],
    [
      "non-string key",
      JSON.stringify({ v1: 1, v2: encodedKey(2) }),
      "expert_referral_key_map_invalid",
    ],
    [
      "non-canonical base64url",
      JSON.stringify({ v1: `${encodedKey(1)}=`, v2: encodedKey(2) }),
      "expert_referral_key_invalid",
    ],
    [
      "short key",
      JSON.stringify({
        v1: Buffer.alloc(31, 1).toString("base64url"),
        v2: encodedKey(2),
      }),
      "expert_referral_key_invalid",
    ],
  ])("rejects a %s secret value with a safe reason", (_label, value, code) => {
    const error = safeError(() =>
      new EnvironmentExpertCodeSecretResolver({
        EXPERT_REFERRAL_HMAC_KEYS_JSON: value,
      }).resolve(request),
    );

    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
  });

  it("requires the configured current version and every active issued-code version", () => {
    const onlyV1 = JSON.stringify({ v1: encodedKey(1) });
    const currentError = safeError(() =>
      new EnvironmentExpertCodeSecretResolver({
        EXPERT_REFERRAL_HMAC_KEYS_JSON: onlyV1,
      }).resolve(request),
    );
    expect(currentError).toMatchObject({
      code: "expert_referral_key_unavailable",
      versions: ["v2"],
    });

    const v1v2 = JSON.stringify({ v1: encodedKey(1), v2: encodedKey(2) });
    const activeError = safeError(() =>
      new EnvironmentExpertCodeSecretResolver({
        EXPERT_REFERRAL_HMAC_KEYS_JSON: v1v2,
      }).resolve({ ...request, requiredVersions: ["v1", "v3"] }),
    );
    expect(activeError).toMatchObject({
      code: "expert_referral_key_unavailable",
      versions: ["v3"],
    });
  });

  it("never includes encoded or decoded key material in resolution errors", () => {
    const shortSecret = Buffer.alloc(31, 7).toString("base64url");
    const raw = JSON.stringify({ v1: shortSecret, v2: encodedKey(2) });
    const error = safeError(() =>
      new EnvironmentExpertCodeSecretResolver({
        EXPERT_REFERRAL_HMAC_KEYS_JSON: raw,
      }).resolve(request),
    );
    const loggable = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      versions: error.versions,
    });

    expect(loggable).not.toContain(shortSecret);
    expect(loggable).not.toContain(raw);
    expect(loggable).not.toContain(Buffer.alloc(31, 7).toString("hex"));
  });

  it("does not echo an invalid requested version label", () => {
    const secretLikeVersion = "not-a-version-with-secret-content";
    const keyring = new EnvironmentExpertCodeSecretResolver({
      EXPERT_REFERRAL_HMAC_KEYS_JSON: JSON.stringify({
        v1: encodedKey(1),
        v2: encodedKey(2),
      }),
    }).resolve(request);

    const error = safeError(() => keyring.key(secretLikeVersion));

    expect(error.versions).toEqual([]);
    expect(JSON.stringify(error.versions)).not.toContain(secretLikeVersion);
  });
});
