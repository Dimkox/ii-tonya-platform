import { createHash, webcrypto } from "node:crypto";

export type ClientConversationToolProposal =
  | Readonly<{
      kind: "show_catalog";
      serviceCode?: string;
      language?: string;
    }>
  | Readonly<{
      kind: "start_booking";
      choiceHandle: `ch1.${string}`;
    }>;

export interface ClientConversationOperationFrameInput {
  readonly operationId: string;
  readonly messageEventId: string;
  readonly bindingId: string;
  readonly keyId: string;
  readonly payloadExpiresAt: string;
  readonly proposal: ClientConversationToolProposal;
}

export type ClientConversationOperationKeyState =
  "active" | "decrypt_only" | "retired" | "compromised";

export interface ClientConversationOperationKey {
  readonly keyId: string;
  readonly state: ClientConversationOperationKeyState;
  readonly key: Awaited<ReturnType<typeof webcrypto.subtle.importKey>>;
  readonly decryptUntil?: string;
}

export interface ClientConversationOperationKeyProvider {
  activeKey(): Promise<ClientConversationOperationKey>;
  keyById(keyId: string): Promise<ClientConversationOperationKey | null>;
  randomNonce(): Buffer;
}

export class ClientConversationOperationCryptoError extends Error {
  readonly code = "crypto_invalid" as const;

  constructor() {
    super("Client conversation operation cryptography failed");
    this.name = "ClientConversationOperationCryptoError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/u;
const choiceHandlePattern = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/u;

const canonicalInstant = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};

const exactPlainRecord = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
};

const validOptionalProposalValue = (
  value: unknown,
  maximum: number,
): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value &&
    !controlCharacters.test(value));

const validateFrameInput = (
  input: ClientConversationOperationFrameInput,
): void => {
  try {
    if (
      !exactPlainRecord(input, [
        "operationId",
        "messageEventId",
        "bindingId",
        "keyId",
        "payloadExpiresAt",
        "proposal",
      ]) ||
      typeof input.operationId !== "string" ||
      !uuidPattern.test(input.operationId) ||
      typeof input.messageEventId !== "string" ||
      !uuidPattern.test(input.messageEventId) ||
      typeof input.bindingId !== "string" ||
      !uuidPattern.test(input.bindingId) ||
      typeof input.keyId !== "string" ||
      !keyIdPattern.test(input.keyId) ||
      !canonicalInstant(input.payloadExpiresAt) ||
      !exactPlainRecord(
        input.proposal,
        ["kind"],
        ["serviceCode", "language", "choiceHandle"],
      )
    ) {
      throw new ClientConversationOperationCryptoError();
    }
    if (input.proposal.kind === "show_catalog") {
      if (
        !exactPlainRecord(
          input.proposal,
          ["kind"],
          ["serviceCode", "language"],
        ) ||
        !validOptionalProposalValue(input.proposal.serviceCode, 64) ||
        !validOptionalProposalValue(input.proposal.language, 32)
      ) {
        throw new ClientConversationOperationCryptoError();
      }
      return;
    }
    if (
      input.proposal.kind !== "start_booking" ||
      !exactPlainRecord(input.proposal, ["kind", "choiceHandle"]) ||
      typeof input.proposal.choiceHandle !== "string" ||
      !choiceHandlePattern.test(input.proposal.choiceHandle)
    ) {
      throw new ClientConversationOperationCryptoError();
    }
  } catch (error) {
    if (error instanceof ClientConversationOperationCryptoError) throw error;
    throw new ClientConversationOperationCryptoError();
  }
};

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

const operationAad = (input: {
  readonly keyId: string;
  readonly operationId: string;
  readonly messageEventId: string;
  readonly bindingId: string;
  readonly toolKind: "show_catalog" | "start_booking";
  readonly requiredScope: "client_catalog:read" | "client_booking:write";
  readonly proposalDigest: string;
  readonly payloadExpiresAt: string;
}): Buffer =>
  Buffer.concat([
    Buffer.from("ii-tonya/client-conversation-operation-aead/v1\0", "utf8"),
    ...[
      "1",
      input.keyId,
      input.operationId,
      input.messageEventId,
      input.bindingId,
      input.toolKind,
      input.requiredScope,
      input.proposalDigest,
      input.payloadExpiresAt,
    ].map(lp),
  ]);

export const frameClientConversationOperation = (
  input: ClientConversationOperationFrameInput,
): Readonly<{
  requiredScope: "client_catalog:read" | "client_booking:write";
  proposalDigest: string;
  plaintext: Buffer;
  aad: Buffer;
}> => {
  validateFrameInput(input);
  const requiredScope =
    input.proposal.kind === "show_catalog"
      ? "client_catalog:read"
      : "client_booking:write";
  const proposalFields =
    input.proposal.kind === "show_catalog"
      ? [
          input.messageEventId,
          input.bindingId,
          input.proposal.kind,
          input.proposal.serviceCode ?? "",
          input.proposal.language ?? "",
        ]
      : [
          input.messageEventId,
          input.bindingId,
          input.proposal.kind,
          input.proposal.choiceHandle,
        ];
  const proposalDigest = createHash("sha256")
    .update("ii-tonya/client-conversation-operation/v1\0", "utf8")
    .update(Buffer.concat(proposalFields.map(lp)))
    .digest("hex");
  const plaintextFields =
    input.proposal.kind === "show_catalog"
      ? [
          input.proposal.kind,
          input.proposal.serviceCode ?? "",
          input.proposal.language ?? "",
        ]
      : [input.proposal.kind, input.proposal.choiceHandle];
  const plaintext = Buffer.concat(plaintextFields.map(lp));
  const aad = operationAad({
    ...input,
    toolKind: input.proposal.kind,
    requiredScope,
    proposalDigest,
  });
  return { requiredScope, proposalDigest, plaintext, aad };
};

const validEncryptionKey = (
  candidate: ClientConversationOperationKey,
): boolean => {
  const algorithm = candidate.key.algorithm;
  return (
    candidate.state === "active" &&
    keyIdPattern.test(candidate.keyId) &&
    !candidate.key.extractable &&
    candidate.key.usages.includes("encrypt") &&
    algorithm.name === "AES-GCM" &&
    "length" in algorithm &&
    algorithm.length === 256
  );
};

const validDecryptionKey = (
  candidate: ClientConversationOperationKey,
  keyId: string,
  payloadExpiresAt: string,
): boolean => {
  const algorithm = candidate.key.algorithm;
  const expiry = Date.parse(payloadExpiresAt);
  const decryptUntil =
    candidate.decryptUntil === undefined
      ? Number.NaN
      : Date.parse(candidate.decryptUntil);
  return (
    candidate.keyId === keyId &&
    (candidate.state === "active" || candidate.state === "decrypt_only") &&
    keyIdPattern.test(candidate.keyId) &&
    !candidate.key.extractable &&
    candidate.key.usages.includes("decrypt") &&
    algorithm.name === "AES-GCM" &&
    "length" in algorithm &&
    algorithm.length === 256 &&
    (candidate.state === "active" ||
      (Number.isFinite(expiry) &&
        Number.isFinite(decryptUntil) &&
        decryptUntil >= expiry + 6 * 60_000))
  );
};

const decodePlaintext = (
  plaintext: Buffer,
  toolKind: "show_catalog" | "start_booking",
): ClientConversationToolProposal => {
  let offset = 0;
  const next = (): string => {
    if (offset + 4 > plaintext.length) {
      throw new ClientConversationOperationCryptoError();
    }
    const length = plaintext.readUInt32BE(offset);
    offset += 4;
    if (offset + length > plaintext.length) {
      throw new ClientConversationOperationCryptoError();
    }
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      plaintext.subarray(offset, offset + length),
    );
    offset += length;
    return value;
  };
  const encodedKind = next();
  if (encodedKind !== toolKind) {
    throw new ClientConversationOperationCryptoError();
  }
  let proposal: ClientConversationToolProposal;
  if (toolKind === "show_catalog") {
    const serviceCode = next();
    const language = next();
    const validOptional = (value: string, maximum: number): boolean =>
      value === "" ||
      (value.length <= maximum &&
        value.trim() === value &&
        !/[\u0000-\u001F\u007F-\u009F]/u.test(value));
    if (!validOptional(serviceCode, 64) || !validOptional(language, 32)) {
      throw new ClientConversationOperationCryptoError();
    }
    proposal = {
      kind: "show_catalog",
      ...(serviceCode === "" ? {} : { serviceCode }),
      ...(language === "" ? {} : { language }),
    };
  } else {
    const choiceHandle = next();
    if (!choiceHandlePattern.test(choiceHandle)) {
      throw new ClientConversationOperationCryptoError();
    }
    proposal = {
      kind: "start_booking",
      choiceHandle: choiceHandle as `ch1.${string}`,
    };
  }
  if (offset !== plaintext.length) {
    throw new ClientConversationOperationCryptoError();
  }
  return Object.freeze(proposal);
};

export const createClientConversationOperationCrypto = (
  provider: ClientConversationOperationKeyProvider,
) => ({
  async encrypt(
    input: Omit<ClientConversationOperationFrameInput, "keyId">,
  ): Promise<
    Readonly<{
      envelopeVersion: 1;
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
      requiredScope: "client_catalog:read" | "client_booking:write";
      proposalDigest: string;
    }>
  > {
    let plaintext: Buffer | undefined;
    let aad: Buffer | undefined;
    try {
      const active = await provider.activeKey();
      if (!validEncryptionKey(active)) {
        throw new ClientConversationOperationCryptoError();
      }
      const nonce = provider.randomNonce();
      if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
        throw new ClientConversationOperationCryptoError();
      }
      const framed = frameClientConversationOperation({
        ...input,
        keyId: active.keyId,
      });
      plaintext = framed.plaintext;
      aad = framed.aad;
      const encrypted = Buffer.from(
        await webcrypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: nonce,
            additionalData: aad,
            tagLength: 128,
          },
          active.key,
          plaintext,
        ),
      );
      if (encrypted.length < 16) {
        throw new ClientConversationOperationCryptoError();
      }
      return {
        envelopeVersion: 1,
        keyId: active.keyId,
        nonce: Buffer.from(nonce),
        ciphertext: encrypted.subarray(0, -16),
        tag: encrypted.subarray(-16),
        requiredScope: framed.requiredScope,
        proposalDigest: framed.proposalDigest,
      };
    } catch (error) {
      if (error instanceof ClientConversationOperationCryptoError) throw error;
      throw new ClientConversationOperationCryptoError();
    } finally {
      plaintext?.fill(0);
      aad?.fill(0);
    }
  },
  async decrypt(
    input: Readonly<{
      operationId: string;
      messageEventId: string;
      bindingId: string;
      toolKind: "show_catalog" | "start_booking";
      requiredScope: "client_catalog:read" | "client_booking:write";
      proposalDigest: string;
      payloadExpiresAt: string;
      envelopeVersion: number;
      keyId: string;
      nonce: Buffer;
      ciphertext: Buffer;
      tag: Buffer;
    }>,
  ): Promise<ClientConversationToolProposal> {
    let aad: Buffer | undefined;
    let combined: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      if (
        input.envelopeVersion !== 1 ||
        !keyIdPattern.test(input.keyId) ||
        !uuidPattern.test(input.operationId) ||
        !uuidPattern.test(input.messageEventId) ||
        !uuidPattern.test(input.bindingId) ||
        !canonicalInstant(input.payloadExpiresAt) ||
        !/^[0-9a-f]{64}$/u.test(input.proposalDigest) ||
        input.nonce.length !== 12 ||
        input.tag.length !== 16 ||
        !(
          (input.toolKind === "show_catalog" &&
            input.requiredScope === "client_catalog:read") ||
          (input.toolKind === "start_booking" &&
            input.requiredScope === "client_booking:write")
        )
      ) {
        throw new ClientConversationOperationCryptoError();
      }
      const key = await provider.keyById(input.keyId);
      if (
        key === null ||
        !validDecryptionKey(key, input.keyId, input.payloadExpiresAt)
      ) {
        throw new ClientConversationOperationCryptoError();
      }
      aad = operationAad(input);
      combined = Buffer.concat([input.ciphertext, input.tag]);
      plaintext = Buffer.from(
        await webcrypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: input.nonce,
            additionalData: aad,
            tagLength: 128,
          },
          key.key,
          combined,
        ),
      );
      return decodePlaintext(plaintext, input.toolKind);
    } catch (error) {
      if (error instanceof ClientConversationOperationCryptoError) throw error;
      throw new ClientConversationOperationCryptoError();
    } finally {
      aad?.fill(0);
      combined?.fill(0);
      plaintext?.fill(0);
    }
  },
});
