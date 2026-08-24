import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const EXPERT_CODE_PATTERN = /^EXR_[A-Za-z0-9_-]{22}$/u;
const KEY_VERSION_PATTERN = /^v([1-9][0-9]*)$/u;
const DIGEST_PATTERN = /^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$/u;

export interface ExpertCodeKeyring {
  readonly currentVersion: string;
  readonly versions: readonly string[];
  key(version: string): Uint8Array;
}

export interface IssuedExpertCode {
  readonly plaintext: string;
  readonly digest: string;
  readonly keyVersion: number;
  readonly maskedSuffix: string;
}

export interface ExpertCodeDigestCandidate {
  readonly keyVersion: number;
  readonly digest: string;
}

function numericKeyVersion(version: string): number {
  const match = KEY_VERSION_PATTERN.exec(version);
  const numeric = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("invalid_expert_code_key_version");
  }
  return numeric;
}

function versionLabel(version: number): string {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error("unknown_key_version");
  }
  return `v${version}`;
}

function disposableKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength < 32) {
    throw new Error("invalid_expert_code_key");
  }
  return Buffer.from(key);
}

export function digestExpertCode(
  code: string,
  version: string,
  key: Uint8Array,
): string {
  numericKeyVersion(version);
  const secret = disposableKey(key);
  try {
    return `hmac-sha256:${version}:${createHmac("sha256", secret).update(code, "utf8").digest("hex")}`;
  } finally {
    secret.fill(0);
  }
}

export class ExpertCodeCrypto {
  private readonly versions: readonly string[];

  constructor(private readonly keyring: ExpertCodeKeyring) {
    const versions = [...new Set(keyring.versions)];
    if (!versions.includes(keyring.currentVersion)) {
      throw new Error("current_expert_code_key_not_retained");
    }
    versions.forEach(numericKeyVersion);
    this.versions = Object.freeze(versions);
  }

  issue(count: number): readonly IssuedExpertCode[] {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error("invalid_expert_code_batch_size");
    }
    const version = this.keyring.currentVersion;
    const keyVersion = numericKeyVersion(version);
    const issued: IssuedExpertCode[] = [];
    const seen = new Set<string>();
    while (issued.length < count) {
      const plaintext = `EXR_${randomBytes(16).toString("base64url")}`;
      if (seen.has(plaintext)) continue;
      seen.add(plaintext);
      issued.push({
        plaintext,
        digest: digestExpertCode(plaintext, version, this.keyring.key(version)),
        keyVersion,
        maskedSuffix: `…${plaintext.slice(-4)}`,
      });
    }
    return issued;
  }

  digestCandidates(code: string): readonly ExpertCodeDigestCandidate[] {
    if (!EXPERT_CODE_PATTERN.test(code)) throw new Error("invalid_expert_code");
    return this.versions.map((version) => ({
      keyVersion: numericKeyVersion(version),
      digest: digestExpertCode(code, version, this.keyring.key(version)),
    }));
  }

  verify(code: string, storedDigest: string, keyVersion: number): boolean {
    const version = versionLabel(keyVersion);
    if (!this.versions.includes(version))
      throw new Error("unknown_key_version");
    if (!EXPERT_CODE_PATTERN.test(code) || !DIGEST_PATTERN.test(storedDigest)) {
      return false;
    }
    const expected = Buffer.from(
      digestExpertCode(code, version, this.keyring.key(version)),
      "utf8",
    );
    const actual = Buffer.from(storedDigest, "utf8");
    return (
      expected.byteLength === actual.byteLength &&
      timingSafeEqual(expected, actual)
    );
  }
}
