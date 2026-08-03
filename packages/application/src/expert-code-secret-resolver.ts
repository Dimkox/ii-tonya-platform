import { ResolvedExpertCodeKeyring, type ExpertCodeKeyring } from "./expert-code-crypto.js";

export const EXPERT_REFERRAL_KEY_UNAVAILABLE = "expert_referral_key_unavailable";

export interface ExpertCodeKeyringResolver {
  resolve(input: {
    reference: string;
    currentVersion: string;
    requiredVersions: readonly string[];
  }): ExpertCodeKeyring;
}

export function createExpertCodeKeyring(input: {
  currentVersion: string;
  requiredVersions: readonly string[];
  encodedKeys: Readonly<Record<string, string>>;
}): ExpertCodeKeyring {
  const required = new Set([input.currentVersion, ...input.requiredVersions]);
  try {
    const references: Record<string, string> = {};
    const decoded = new Map<string, Uint8Array>();
    for (const version of required) {
      const encoded = input.encodedKeys[version];
      if (encoded === undefined || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error();
      const bytes = new Uint8Array(Buffer.from(encoded, "base64url"));
      if (bytes.byteLength < 32 || Buffer.from(bytes).toString("base64url") !== encoded) {
        bytes.fill(0);
        throw new Error();
      }
      decoded.set(version, bytes);
      references[version] = version;
    }
    return new ResolvedExpertCodeKeyring({
      currentVersion: input.currentVersion,
      secretReferences: references,
      resolve: (version) => decoded.get(version) ?? new Uint8Array(),
    });
  } catch {
    throw new Error(EXPERT_REFERRAL_KEY_UNAVAILABLE);
  }
}
