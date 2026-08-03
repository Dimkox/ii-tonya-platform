const EXPERT_REFERRAL_KEY_UNAVAILABLE = "expert_referral_key_unavailable";

export interface ResolvedEnvironmentExpertCodeKeyring {
  readonly currentVersion: string;
  readonly activeVersions: readonly string[];
  key(version: string): Uint8Array;
}

export class EnvironmentExpertCodeSecretResolver {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  resolve(input: { reference: string; currentVersion: string; requiredVersions: readonly string[] }): ResolvedEnvironmentExpertCodeKeyring {
    const decoded = new Map<string, Uint8Array>();
    try {
      if (input.reference !== "env://EXPERT_REFERRAL_HMAC_KEYS_JSON") throw new Error();
      const raw = this.environment.EXPERT_REFERRAL_HMAC_KEYS_JSON;
      if (raw === undefined) throw new Error();
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      const keys = parsed as Record<string, unknown>;
      if (Object.keys(keys).some((version) => !/^v[1-9]\d*$/u.test(version))) throw new Error();
      if (Object.values(keys).some((value) => typeof value !== "string")) throw new Error();
      const retainedVersions = Object.keys(keys);
      const required = new Set([input.currentVersion, ...input.requiredVersions]);
      if ([...required].some((version) => !retainedVersions.includes(version))) throw new Error();
      for (const version of retainedVersions) {
        const encoded = keys[version];
        if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error();
        const bytes = new Uint8Array(Buffer.from(encoded, "base64url"));
        if (bytes.byteLength < 32 || Buffer.from(bytes).toString("base64url") !== encoded) throw new Error();
        decoded.set(version, bytes);
      }
      return {
        currentVersion: input.currentVersion,
        activeVersions: [input.currentVersion, ...retainedVersions.filter((version) => version !== input.currentVersion)],
        key(version: string) {
          const value = decoded.get(version);
          if (value === undefined) throw new Error(EXPERT_REFERRAL_KEY_UNAVAILABLE);
          return new Uint8Array(value);
        },
      };
    } catch {
      for (const value of decoded.values()) value.fill(0);
      throw new Error(EXPERT_REFERRAL_KEY_UNAVAILABLE);
    }
  }
}
