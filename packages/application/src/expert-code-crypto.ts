import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const EXPERT_CODE_PATTERN = /^EXR_[A-Za-z0-9_-]{22,128}$/u;
const KEY_VERSION_PATTERN = /^v[1-9][0-9]*$/u;
const DIGEST_PATTERN = /^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$/u;

export interface ExpertCodeKeyring {
  readonly currentVersion: string;
  readonly activeVersions: readonly string[];
  key(version: string): Uint8Array;
}

export type ExpertCodeSecretResolver = (secretReference: string) => Uint8Array;

export interface ResolvedExpertCodeKeyringOptions {
  currentVersion: string;
  secretReferences: Readonly<Record<string, string>>;
  resolve: ExpertCodeSecretResolver;
}

export interface IssuedExpertCode {
  plaintext: string;
  digest: string;
  hash: string;
  keyVersion: string;
  maskedSuffix: string;
}

export interface ExpertCodeDigestCandidate {
  digest: string;
  hash: string;
  keyVersion: string;
}

function assertKeyVersion(version: string): void {
  if (!KEY_VERSION_PATTERN.test(version)) {
    throw new Error("Invalid expert referral key version");
  }
}

function safeKeyCopy(key: Uint8Array): Uint8Array {
  if (key.byteLength < 32) {
    throw new Error("Expert referral key material is too short");
  }
  return new Uint8Array(key);
}

export class ResolvedExpertCodeKeyring implements ExpertCodeKeyring {
  readonly currentVersion: string;
  readonly activeVersions: readonly string[];
  readonly #keys = new Map<string, Uint8Array>();

  constructor(options: ResolvedExpertCodeKeyringOptions) {
    assertKeyVersion(options.currentVersion);
    const versions = Object.keys(options.secretReferences);
    if (versions.length > 2) {
      throw new Error(
        "Expert referral keyring must contain at most two versions",
      );
    }
    if (!versions.includes(options.currentVersion)) {
      throw new Error("Current expert referral key version is unavailable");
    }
    for (const version of versions) assertKeyVersion(version);

    try {
      for (const version of versions) {
        const reference = options.secretReferences[version];
        if (reference === undefined || reference.length === 0) {
          throw new Error("Expert referral key reference is unavailable");
        }
        const disposable = options.resolve(reference);
        try {
          this.#keys.set(version, safeKeyCopy(disposable));
        } finally {
          disposable.fill(0);
        }
      }
    } catch (error) {
      this.destroy();
      throw error;
    }

    this.currentVersion = options.currentVersion;
    this.activeVersions = Object.freeze([
      options.currentVersion,
      ...versions.filter((version) => version !== options.currentVersion),
    ]);
  }

  key(version: string): Uint8Array {
    const stored = this.#keys.get(version);
    if (stored === undefined) {
      throw new Error("Expert referral key version is unavailable");
    }
    return new Uint8Array(stored);
  }

  destroy(): void {
    for (const key of this.#keys.values()) key.fill(0);
    this.#keys.clear();
  }
}

export function digestExpertCode(
  code: string,
  version: string,
  key: Uint8Array,
): string {
  assertKeyVersion(version);
  const hash = createHmac("sha256", key).update(code, "utf8").digest("hex");
  return `hmac-sha256:${version}:${hash}`;
}

export function expertCodeDigestsEqual(left: string, right: string): boolean {
  if (!DIGEST_PATTERN.test(left) || !DIGEST_PATTERN.test(right)) return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function digestWithDisposableKey(
  keyring: ExpertCodeKeyring,
  plaintext: string,
  version: string,
): ExpertCodeDigestCandidate {
  const key = keyring.key(version);
  try {
    const digest = digestExpertCode(plaintext, version, key);
    return {
      digest,
      hash: digest.slice(digest.lastIndexOf(":") + 1),
      keyVersion: version,
    };
  } finally {
    key.fill(0);
  }
}

export class ExpertCodeCrypto {
  constructor(private readonly keyring: ExpertCodeKeyring) {
    assertKeyVersion(keyring.currentVersion);
    if (!keyring.activeVersions.includes(keyring.currentVersion)) {
      throw new Error("Current expert referral key version is inactive");
    }
  }

  issue(count: number): IssuedExpertCode[] {
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
      throw new RangeError(
        "Expert referral batch size must be between 1 and 1000",
      );
    }

    return Array.from({ length: count }, () => {
      const random = randomBytes(16);
      let plaintext: string;
      try {
        plaintext = `EXR_${random.toString("base64url")}`;
      } finally {
        random.fill(0);
      }
      const candidate = digestWithDisposableKey(
        this.keyring,
        plaintext,
        this.keyring.currentVersion,
      );
      return {
        plaintext,
        ...candidate,
        maskedSuffix: plaintext.slice(-6),
      };
    });
  }

  digestCandidates(plaintext: string): ExpertCodeDigestCandidate[] {
    if (!EXPERT_CODE_PATTERN.test(plaintext)) {
      throw new Error("Invalid expert referral code");
    }
    return this.keyring.activeVersions.map((version) =>
      digestWithDisposableKey(this.keyring, plaintext, version),
    );
  }
}
