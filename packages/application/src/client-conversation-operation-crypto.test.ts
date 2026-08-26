import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ClientConversationOperationCryptoError,
  createClientConversationOperationCrypto,
  frameClientConversationOperation,
  type ClientConversationOperationKey,
  type ClientConversationOperationFrameInput,
} from "./client-conversation-operation-crypto.js";

const base = {
  operationId: "10000000-0000-4000-8000-000000000001",
  messageEventId: "20000000-0000-4000-8000-000000000002",
  bindingId: "30000000-0000-4000-8000-000000000003",
  keyId: "active-key_1",
  payloadExpiresAt: "2026-07-29T10:00:00.000Z",
} as const;

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

const expectedDigest = (
  input: ClientConversationOperationFrameInput,
): string => {
  const fields =
    input.proposal.kind === "show_catalog"
      ? [
          input.messageEventId,
          input.bindingId,
          "show_catalog",
          input.proposal.serviceCode ?? "",
          input.proposal.language ?? "",
        ]
      : [
          input.messageEventId,
          input.bindingId,
          "start_booking",
          input.proposal.choiceHandle,
        ];
  return createHash("sha256")
    .update("ii-tonya/client-conversation-operation/v1\0", "utf8")
    .update(Buffer.concat(fields.map(lp)))
    .digest("hex");
};

describe("client conversation operation framing", () => {
  it("binds an exact catalog proposal into its digest, plaintext, and AEAD metadata", () => {
    const input: ClientConversationOperationFrameInput = {
      ...base,
      proposal: {
        kind: "show_catalog",
        serviceCode: "massage",
        language: "ru",
      },
    };

    const framed = frameClientConversationOperation(input);

    expect(framed.requiredScope).toBe("client_catalog:read");
    expect(framed.proposalDigest).toBe(expectedDigest(input));
    expect(framed.plaintext).toEqual(
      Buffer.concat([lp("show_catalog"), lp("massage"), lp("ru")]),
    );
    expect(framed.aad).toEqual(
      Buffer.concat([
        Buffer.from("ii-tonya/client-conversation-operation-aead/v1\0"),
        lp("1"),
        lp(base.keyId),
        lp(base.operationId),
        lp(base.messageEventId),
        lp(base.bindingId),
        lp("show_catalog"),
        lp("client_catalog:read"),
        lp(expectedDigest(input)),
        lp(base.payloadExpiresAt),
      ]),
    );
  });

  it("uses only the opaque choice handle in booking plaintext", () => {
    const input: ClientConversationOperationFrameInput = {
      ...base,
      proposal: {
        kind: "start_booking",
        choiceHandle: `ch1.${"A".repeat(43)}`,
      },
    };

    const framed = frameClientConversationOperation(input);

    expect(framed.requiredScope).toBe("client_booking:write");
    expect(framed.proposalDigest).toBe(expectedDigest(input));
    expect(framed.plaintext).toEqual(
      Buffer.concat([lp("start_booking"), lp(`ch1.${"A".repeat(43)}`)]),
    );
  });

  it.each([
    {
      ...base,
      payloadExpiresAt: "2026-07-29T10:00:00Z",
      proposal: { kind: "show_catalog" },
    },
    { ...base, keyId: "bad key", proposal: { kind: "show_catalog" } },
    { ...base, operationId: "not-a-uuid", proposal: { kind: "show_catalog" } },
    { ...base, proposal: { kind: "show_catalog", serviceCode: " padded" } },
    { ...base, proposal: { kind: "show_catalog", extra: "mixed" } },
    { ...base, proposal: { kind: "start_booking", choiceHandle: "ch1.short" } },
  ])(
    "rejects malformed framing input before producing cryptographic material %#",
    (input) => {
      expect(() =>
        frameClientConversationOperation(
          input as unknown as ClientConversationOperationFrameInput,
        ),
      ).toThrow(ClientConversationOperationCryptoError);
    },
  );
});

const nonExtractableKey = async (): Promise<
  Awaited<ReturnType<typeof webcrypto.subtle.importKey>>
> =>
  webcrypto.subtle.importKey(
    "raw",
    Buffer.alloc(32),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

describe("client conversation operation encryption", () => {
  it("produces the contract AES-256-GCM v1 envelope with a 96-bit nonce", async () => {
    const key: ClientConversationOperationKey = {
      keyId: base.keyId,
      state: "active",
      key: await nonExtractableKey(),
    };
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
    });

    const encrypted = await crypto.encrypt({
      operationId: base.operationId,
      messageEventId: base.messageEventId,
      bindingId: base.bindingId,
      payloadExpiresAt: base.payloadExpiresAt,
      proposal: {
        kind: "show_catalog",
        serviceCode: "massage",
        language: "ru",
      },
    });

    expect(encrypted).toMatchObject({
      envelopeVersion: 1,
      keyId: base.keyId,
      requiredScope: "client_catalog:read",
      proposalDigest:
        "1962e6151043f342d58988e4eec8d70ee9c1b40b29013bb42b0c03a89fb87407",
    });
    expect(encrypted.nonce.toString("hex")).toBe("000102030405060708090a0b");
    expect(encrypted.ciphertext.toString("hex")).toBe(
      "88cb335e7395e08e9d1b33919c6fb16b546ca89dd2fcfc85aeac810b8d350d1d99",
    );
    expect(encrypted.tag.toString("hex")).toBe(
      "0296a1313e1d6b02889bf7f9b5e9152b",
    );
  });

  it.each(["decrypt_only", "retired", "compromised"] as const)(
    "refuses to encrypt with a %s key",
    async (state) => {
      const key: ClientConversationOperationKey = {
        keyId: base.keyId,
        state,
        key: await nonExtractableKey(),
        ...(state === "decrypt_only"
          ? { decryptUntil: "2026-07-29T10:06:00.000Z" }
          : {}),
      };
      const crypto = createClientConversationOperationCrypto({
        activeKey: async () => key,
        keyById: async () => key,
        randomNonce: () => Buffer.alloc(12),
      });

      await expect(
        crypto.encrypt({
          operationId: base.operationId,
          messageEventId: base.messageEventId,
          bindingId: base.bindingId,
          payloadExpiresAt: base.payloadExpiresAt,
          proposal: { kind: "show_catalog" },
        }),
      ).rejects.toBeInstanceOf(ClientConversationOperationCryptoError);
    },
  );

  it("rejects a decrypt-only key whose custody ends before expiry plus six minutes", async () => {
    const active: ClientConversationOperationKey = {
      keyId: base.keyId,
      state: "active",
      key: await nonExtractableKey(),
    };
    const insufficient = {
      ...active,
      state: "decrypt_only" as const,
      decryptUntil: "2026-07-29T10:05:59.999Z",
    };
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => active,
      keyById: async () => insufficient,
      randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
    });
    const metadata = {
      operationId: base.operationId,
      messageEventId: base.messageEventId,
      bindingId: base.bindingId,
      payloadExpiresAt: base.payloadExpiresAt,
      proposal: { kind: "show_catalog" as const },
    };
    const encrypted = await crypto.encrypt(metadata);

    await expect(
      crypto.decrypt({
        ...metadata,
        toolKind: "show_catalog",
        requiredScope: encrypted.requiredScope,
        proposalDigest: encrypted.proposalDigest,
        envelopeVersion: encrypted.envelopeVersion,
        keyId: encrypted.keyId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: encrypted.tag,
      }),
    ).rejects.toMatchObject({ code: "crypto_invalid" });
  });

  it("rejects extractable or non-AES-256 key capabilities", async () => {
    const extractable = await webcrypto.subtle.importKey(
      "raw",
      Buffer.alloc(16),
      { name: "AES-GCM" },
      true,
      ["encrypt"],
    );
    const key: ClientConversationOperationKey = {
      keyId: base.keyId,
      state: "active",
      key: extractable,
    };
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.alloc(12),
    });

    await expect(
      crypto.encrypt({
        operationId: base.operationId,
        messageEventId: base.messageEventId,
        bindingId: base.bindingId,
        payloadExpiresAt: base.payloadExpiresAt,
        proposal: { kind: "show_catalog" },
      }),
    ).rejects.toMatchObject({ code: "crypto_invalid" });
  });

  it("rejects a non-canonical payload expiry with an active key", async () => {
    const key: ClientConversationOperationKey = {
      keyId: base.keyId,
      state: "active",
      key: await nonExtractableKey(),
    };
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.alloc(12),
    });

    await expect(
      crypto.encrypt({
        operationId: base.operationId,
        messageEventId: base.messageEventId,
        bindingId: base.bindingId,
        payloadExpiresAt: "2026-07-29T10:00:00Z",
        proposal: { kind: "show_catalog" },
      }),
    ).rejects.toMatchObject({ code: "crypto_invalid" });
  });

  it("keeps both envelopes decryptable when the active key rotates", async () => {
    const firstKey: ClientConversationOperationKey = {
      keyId: "rotation-key-1",
      state: "active",
      key: await nonExtractableKey(),
    };
    const secondKey: ClientConversationOperationKey = {
      keyId: "rotation-key-2",
      state: "active",
      key: await webcrypto.subtle.importKey(
        "raw",
        Buffer.alloc(32, 1),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    let active = firstKey;
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => active,
      keyById: async (keyId) => {
        if (keyId === firstKey.keyId) {
          return {
            ...firstKey,
            state: "decrypt_only",
            decryptUntil: "2026-07-29T10:06:00.000Z",
          };
        }
        return keyId === secondKey.keyId ? secondKey : null;
      },
      randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
    });
    const firstMetadata = {
      operationId: base.operationId,
      messageEventId: base.messageEventId,
      bindingId: base.bindingId,
      payloadExpiresAt: base.payloadExpiresAt,
      proposal: { kind: "show_catalog" as const, serviceCode: "first" },
    };
    const first = await crypto.encrypt(firstMetadata);
    active = secondKey;
    const secondMetadata = {
      ...firstMetadata,
      operationId: "70000000-0000-4000-8000-000000000007",
      messageEventId: "80000000-0000-4000-8000-000000000008",
      proposal: { kind: "show_catalog" as const, serviceCode: "second" },
    };
    const second = await crypto.encrypt(secondMetadata);

    expect([first.keyId, second.keyId]).toEqual([
      "rotation-key-1",
      "rotation-key-2",
    ]);
    await expect(
      crypto.decrypt({
        ...firstMetadata,
        toolKind: "show_catalog",
        requiredScope: first.requiredScope,
        proposalDigest: first.proposalDigest,
        envelopeVersion: first.envelopeVersion,
        keyId: first.keyId,
        nonce: first.nonce,
        ciphertext: first.ciphertext,
        tag: first.tag,
      }),
    ).resolves.toEqual(firstMetadata.proposal);
    await expect(
      crypto.decrypt({
        ...secondMetadata,
        toolKind: "show_catalog",
        requiredScope: second.requiredScope,
        proposalDigest: second.proposalDigest,
        envelopeVersion: second.envelopeVersion,
        keyId: second.keyId,
        nonce: second.nonce,
        ciphertext: second.ciphertext,
        tag: second.tag,
      }),
    ).resolves.toEqual(secondMetadata.proposal);
  });
});

describe("client conversation operation decryption", () => {
  it.each(["active", "decrypt_only"] as const)(
    "decrypts an intact envelope with a %s key",
    async (state) => {
      const key: ClientConversationOperationKey = {
        keyId: base.keyId,
        state,
        key: await nonExtractableKey(),
        ...(state === "decrypt_only"
          ? { decryptUntil: "2026-07-29T10:06:00.000Z" }
          : {}),
      };
      const crypto = createClientConversationOperationCrypto({
        activeKey: async () => ({ ...key, state: "active" }),
        keyById: async () => key,
        randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
      });
      const metadata = {
        operationId: base.operationId,
        messageEventId: base.messageEventId,
        bindingId: base.bindingId,
        payloadExpiresAt: base.payloadExpiresAt,
        proposal: {
          kind: "show_catalog" as const,
          serviceCode: "massage",
          language: "ru",
        },
      };
      const encrypted = await crypto.encrypt(metadata);

      await expect(
        crypto.decrypt({
          ...metadata,
          toolKind: "show_catalog",
          requiredScope: encrypted.requiredScope,
          proposalDigest: encrypted.proposalDigest,
          envelopeVersion: encrypted.envelopeVersion,
          keyId: encrypted.keyId,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext,
          tag: encrypted.tag,
        }),
      ).resolves.toEqual(metadata.proposal);
    },
  );

  it.each(["retired", "compromised"] as const)(
    "normalizes a %s key rejection to crypto_invalid",
    async (state) => {
      const key: ClientConversationOperationKey = {
        keyId: base.keyId,
        state,
        key: await nonExtractableKey(),
      };
      const crypto = createClientConversationOperationCrypto({
        activeKey: async () => ({ ...key, state: "active" }),
        keyById: async () => key,
        randomNonce: () => Buffer.alloc(12),
      });

      await expect(
        crypto.decrypt({
          ...base,
          toolKind: "show_catalog",
          requiredScope: "client_catalog:read",
          proposalDigest: "a".repeat(64),
          envelopeVersion: 1,
          nonce: Buffer.alloc(12),
          ciphertext: Buffer.alloc(1),
          tag: Buffer.alloc(16),
        }),
      ).rejects.toMatchObject({ code: "crypto_invalid" });
    },
  );

  it("normalizes an authentication-tag swap without revealing the failed check", async () => {
    const key: ClientConversationOperationKey = {
      keyId: base.keyId,
      state: "active",
      key: await nonExtractableKey(),
    };
    const crypto = createClientConversationOperationCrypto({
      activeKey: async () => key,
      keyById: async () => key,
      randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
    });
    const metadata = {
      operationId: base.operationId,
      messageEventId: base.messageEventId,
      bindingId: base.bindingId,
      payloadExpiresAt: base.payloadExpiresAt,
      proposal: { kind: "show_catalog" as const },
    };
    const encrypted = await crypto.encrypt(metadata);
    const swappedTag = Buffer.from(encrypted.tag);
    swappedTag[0] = swappedTag[0]! ^ 1;

    const error = await crypto
      .decrypt({
        ...metadata,
        toolKind: "show_catalog",
        requiredScope: encrypted.requiredScope,
        proposalDigest: encrypted.proposalDigest,
        envelopeVersion: encrypted.envelopeVersion,
        keyId: encrypted.keyId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: swappedTag,
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "crypto_invalid",
      message: "Client conversation operation cryptography failed",
    });
    expect(JSON.stringify(error)).not.toMatch(/tag|authentication|key/i);
  });

  it.each([
    [
      "ciphertext",
      (input: Record<string, unknown>) => {
        const value = Buffer.from(input.ciphertext as Buffer);
        value[0] = value[0]! ^ 1;
        return { ...input, ciphertext: value };
      },
    ],
    [
      "nonce",
      (input: Record<string, unknown>) => ({
        ...input,
        nonce: Buffer.alloc(12, 1),
      }),
    ],
    [
      "operation id",
      (input: Record<string, unknown>) => ({
        ...input,
        operationId: "40000000-0000-4000-8000-000000000004",
      }),
    ],
    [
      "message event id",
      (input: Record<string, unknown>) => ({
        ...input,
        messageEventId: "50000000-0000-4000-8000-000000000005",
      }),
    ],
    [
      "binding id",
      (input: Record<string, unknown>) => ({
        ...input,
        bindingId: "60000000-0000-4000-8000-000000000006",
      }),
    ],
    [
      "tool and scope",
      (input: Record<string, unknown>) => ({
        ...input,
        toolKind: "start_booking",
        requiredScope: "client_booking:write",
      }),
    ],
    [
      "proposal digest",
      (input: Record<string, unknown>) => ({
        ...input,
        proposalDigest: "b".repeat(64),
      }),
    ],
    [
      "payload expiry",
      (input: Record<string, unknown>) => ({
        ...input,
        payloadExpiresAt: "2026-07-29T10:00:01.000Z",
      }),
    ],
    [
      "envelope version",
      (input: Record<string, unknown>) => ({ ...input, envelopeVersion: 2 }),
    ],
    [
      "key id",
      (input: Record<string, unknown>) => ({ ...input, keyId: "other-key" }),
    ],
  ] as const)(
    "normalizes a %s swap to crypto_invalid",
    async (_name, mutate) => {
      const key: ClientConversationOperationKey = {
        keyId: base.keyId,
        state: "active",
        key: await nonExtractableKey(),
      };
      const crypto = createClientConversationOperationCrypto({
        activeKey: async () => key,
        keyById: async () => key,
        randomNonce: () => Buffer.from("000102030405060708090a0b", "hex"),
      });
      const metadata = {
        operationId: base.operationId,
        messageEventId: base.messageEventId,
        bindingId: base.bindingId,
        payloadExpiresAt: base.payloadExpiresAt,
        proposal: { kind: "show_catalog" as const },
      };
      const encrypted = await crypto.encrypt(metadata);
      const validInput = {
        operationId: metadata.operationId,
        messageEventId: metadata.messageEventId,
        bindingId: metadata.bindingId,
        payloadExpiresAt: metadata.payloadExpiresAt,
        toolKind: "show_catalog" as const,
        requiredScope: encrypted.requiredScope,
        proposalDigest: encrypted.proposalDigest,
        envelopeVersion: encrypted.envelopeVersion,
        keyId: encrypted.keyId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: encrypted.tag,
      };

      const error = await crypto
        .decrypt(mutate(validInput) as Parameters<typeof crypto.decrypt>[0])
        .catch((value: unknown) => value);

      expect(error).toMatchObject({
        code: "crypto_invalid",
        message: "Client conversation operation cryptography failed",
      });
    },
  );
});
