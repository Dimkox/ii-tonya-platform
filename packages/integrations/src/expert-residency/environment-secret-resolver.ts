const KEY_REFERENCE = "env://EXPERT_REFERRAL_HMAC_KEYS_JSON";
const KEY_ENVIRONMENT_NAME = "EXPERT_REFERRAL_HMAC_KEYS_JSON";
const VERSION_PATTERN = /^v([1-9][0-9]*)$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const isSafeVersionLabel = (version: string): boolean => {
  const match = VERSION_PATTERN.exec(version);
  const numeric = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(numeric) && numeric > 0;
};

export interface EnvironmentExpertCodeKeyring {
  readonly currentVersion: string;
  readonly versions: readonly string[];
  key(version: string): Uint8Array;
}

export interface EnvironmentExpertCodeSecretResolution {
  readonly currentVersion: string;
  readonly reference: typeof KEY_REFERENCE;
  readonly requiredVersions: readonly string[];
}

export class ExpertCodeSecretResolutionError extends Error {
  readonly versions: readonly string[];

  constructor(
    readonly code: string,
    versions: readonly string[] = [],
  ) {
    super(code);
    this.name = "ExpertCodeSecretResolutionError";
    this.versions = Object.freeze([
      ...new Set(versions.filter(isSafeVersionLabel)),
    ]);
  }
}

const fail = (code: string, versions: readonly string[] = []): never => {
  throw new ExpertCodeSecretResolutionError(code, versions);
};

const numericVersion = (version: string): number => {
  const match = VERSION_PATTERN.exec(version);
  const number = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return fail("expert_referral_key_map_invalid");
  }
  return number;
};

const parseKeyMap = (raw: string): ReadonlyMap<string, Uint8Array> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("expert_referral_key_map_invalid");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    return fail("expert_referral_key_map_invalid");
  }

  const record = parsed as Record<string, unknown>;
  const decoded = new Map<string, Uint8Array>();
  try {
    for (const [version, encoded] of Object.entries(record)) {
      numericVersion(version);
      if (typeof encoded !== "string") {
        return fail("expert_referral_key_map_invalid");
      }
      if (!BASE64URL_PATTERN.test(encoded)) {
        return fail("expert_referral_key_invalid", [version]);
      }
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded || bytes.byteLength < 32) {
        bytes.fill(0);
        return fail("expert_referral_key_invalid", [version]);
      }
      decoded.set(version, Uint8Array.from(bytes));
      bytes.fill(0);
    }
  } catch (error) {
    for (const key of decoded.values()) key.fill(0);
    throw error;
  }
  return decoded;
};

export class EnvironmentExpertCodeSecretResolver {
  constructor(
    private readonly source: Readonly<Record<string, string | undefined>>,
  ) {}

  resolve(
    input: EnvironmentExpertCodeSecretResolution,
  ): EnvironmentExpertCodeKeyring {
    if (input.reference !== KEY_REFERENCE) {
      return fail("expert_referral_key_reference_invalid");
    }
    numericVersion(input.currentVersion);
    for (const version of input.requiredVersions) numericVersion(version);

    let raw: string | undefined;
    try {
      raw = this.source[KEY_ENVIRONMENT_NAME];
    } catch {
      return fail("expert_referral_key_unavailable");
    }
    if (raw === undefined) return fail("expert_referral_key_unavailable");
    const decoded = parseKeyMap(raw);
    const required = [
      ...new Set([input.currentVersion, ...input.requiredVersions]),
    ];
    const missing = required.filter((version) => !decoded.has(version));
    if (missing.length > 0) {
      for (const key of decoded.values()) key.fill(0);
      return fail("expert_referral_key_unavailable", missing);
    }
    const versions = [
      input.currentVersion,
      ...[...decoded.keys()]
        .filter((version) => version !== input.currentVersion)
        .sort((left, right) => numericVersion(right) - numericVersion(left)),
    ];

    return Object.freeze({
      currentVersion: input.currentVersion,
      versions: Object.freeze(versions),
      key(version: string): Uint8Array {
        const key = decoded.get(version);
        if (key === undefined) {
          return fail("expert_referral_key_unavailable", [version]);
        }
        return Uint8Array.from(key);
      },
    });
  }
}
