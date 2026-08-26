import type { ExpertCodeKeyring } from "./expert-code-crypto.js";

export interface ExpertCodeSecretResolution {
  readonly currentVersion: string;
  readonly reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON";
  readonly requiredVersions: readonly string[];
}

export interface ExpertCodeSecretResolver {
  resolve(input: ExpertCodeSecretResolution): ExpertCodeKeyring;
}
