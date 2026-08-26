declare const conversationTokenBrand: unique symbol;
declare const conversationIdentityBrand: unique symbol;
declare const conversationOperationClaimBrand: unique symbol;

export type OpaqueConversationToken = string & {
  readonly [conversationTokenBrand]: true;
};

export type ClientConversationIdentity = Readonly<{
  bindingId: string;
  userId: string;
  [conversationIdentityBrand]: true;
}>;

export type ClaimedConversationOperation = Readonly<{
  operationId: string;
  [conversationOperationClaimBrand]: true;
}>;

export type ClientConversationToolKind = "show_catalog" | "start_booking";
export type ClientConversationScope =
  "client_catalog:read" | "client_booking:write";

export type ClientConversationFrozenInput =
  | Readonly<{
      serviceCode?: string;
      language?: string;
    }>
  | Readonly<{ choiceHandle: `ch1.${string}` }>;

export interface ClientConversationIdentityFact {
  readonly bindingId: string;
  readonly userId: string;
}

export interface ClientConversationIdentityFactsPort {
  findActive(input: {
    readonly provider: "selarti.client-thread.v1";
    readonly tenantToken: OpaqueConversationToken;
    readonly subjectToken: OpaqueConversationToken;
    readonly tokenVersion: 1;
  }): Promise<readonly ClientConversationIdentityFact[]>;
}

export interface ClientConversationIdentityResolver {
  resolveIdentity(input: {
    readonly tenantToken: OpaqueConversationToken;
    readonly subjectToken: OpaqueConversationToken;
  }): Promise<
    | {
        readonly kind: "resolved";
        readonly identity: ClientConversationIdentity;
      }
    | { readonly kind: "denied" }
    | { readonly kind: "unavailable" }
  >;
}

export interface ClientConversationOperationClaimDetails {
  readonly operationId: string;
  readonly claimToken: string;
  readonly claimOwnerId: string;
  readonly claimFence: number;
  readonly toolKind: ClientConversationToolKind;
  readonly requiredScope: ClientConversationScope;
  readonly frozenInput: ClientConversationFrozenInput;
}

const tokenPattern = /^hmac-sha256:v1:[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const boundedCodePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const choiceHandlePattern = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const controlPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const validCatalogFilter = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= maximum &&
  value.trim() === value &&
  !controlPattern.test(value);

const exactPlainRecord = (
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): value is Record<string, unknown> => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(value);
    return (
      keys.length === allowedKeys.size &&
      keys.every((key) => allowedKeys.has(key))
    );
  } catch {
    return false;
  }
};

export const parseOpaqueConversationToken = (
  value: unknown,
): OpaqueConversationToken | null =>
  typeof value === "string" && tokenPattern.test(value)
    ? (value as OpaqueConversationToken)
    : null;

const factKeys = new Set(["bindingId", "userId"]);
const identityInputKeys = new Set(["tenantToken", "subjectToken"]);

const validIdentityFact = (
  value: unknown,
): value is ClientConversationIdentityFact =>
  exactPlainRecord(value, factKeys) &&
  typeof value.bindingId === "string" &&
  uuidPattern.test(value.bindingId) &&
  typeof value.userId === "string" &&
  uuidPattern.test(value.userId);

export const createClientConversationIdentityResolver = (
  facts: ClientConversationIdentityFactsPort,
): ClientConversationIdentityResolver =>
  Object.freeze({
    async resolveIdentity(input: {
      readonly tenantToken: OpaqueConversationToken;
      readonly subjectToken: OpaqueConversationToken;
    }) {
      let tenantToken: OpaqueConversationToken | null = null;
      let subjectToken: OpaqueConversationToken | null = null;
      try {
        if (exactPlainRecord(input, identityInputKeys)) {
          tenantToken = parseOpaqueConversationToken(input.tenantToken);
          subjectToken = parseOpaqueConversationToken(input.subjectToken);
        }
      } catch {
        return { kind: "denied" } as const;
      }
      if (tenantToken === null || subjectToken === null) {
        return { kind: "denied" } as const;
      }
      try {
        const rows = await facts.findActive({
          provider: "selarti.client-thread.v1",
          tenantToken,
          subjectToken,
          tokenVersion: 1,
        });
        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          !validIdentityFact(rows[0])
        ) {
          return { kind: "denied" } as const;
        }
        const identity = Object.freeze({
          bindingId: rows[0].bindingId,
          userId: rows[0].userId,
        }) as ClientConversationIdentity;
        return { kind: "resolved", identity } as const;
      } catch {
        return { kind: "unavailable" } as const;
      }
    },
  });

const claimInputKeys = new Set([
  "operationId",
  "claimToken",
  "claimOwnerId",
  "claimFence",
  "toolKind",
  "requiredScope",
  "frozenInput",
]);
const catalogInputKeys = new Set(["serviceCode", "language"]);
const bookingInputKeys = new Set(["choiceHandle"]);

const freezeInput = (
  toolKind: ClientConversationToolKind,
  value: unknown,
): ClientConversationFrozenInput | null => {
  try {
    if (toolKind === "show_catalog") {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const keys = Object.keys(value);
      if (keys.some((key) => !catalogInputKeys.has(key))) return null;
      const record = value as Record<string, unknown>;
      if (
        (record.serviceCode !== undefined &&
          !validCatalogFilter(record.serviceCode, 64)) ||
        (record.language !== undefined &&
          !validCatalogFilter(record.language, 32))
      ) {
        return null;
      }
      return Object.freeze({
        ...(record.serviceCode === undefined
          ? {}
          : { serviceCode: record.serviceCode }),
        ...(record.language === undefined ? {} : { language: record.language }),
      });
    }
    if (!exactPlainRecord(value, bookingInputKeys)) return null;
    return typeof value.choiceHandle === "string" &&
      choiceHandlePattern.test(value.choiceHandle)
      ? Object.freeze({ choiceHandle: value.choiceHandle as `ch1.${string}` })
      : null;
  } catch {
    return null;
  }
};

const genuineClaims = new WeakSet<object>();

class RuntimeConversationOperationClaim {
  readonly operationId: string;
  readonly #details: ClientConversationOperationClaimDetails;

  constructor(details: ClientConversationOperationClaimDetails) {
    this.operationId = details.operationId;
    this.#details = details;
    genuineClaims.add(this);
    Object.freeze(this);
  }

  details(): ClientConversationOperationClaimDetails {
    return this.#details;
  }
}

Object.freeze(RuntimeConversationOperationClaim.prototype);

const validClaimInput = (
  input: unknown,
): ClientConversationOperationClaimDetails | null => {
  try {
    if (!exactPlainRecord(input, claimInputKeys)) return null;
    if (
      typeof input.operationId !== "string" ||
      !uuidPattern.test(input.operationId) ||
      typeof input.claimToken !== "string" ||
      !uuidPattern.test(input.claimToken) ||
      typeof input.claimOwnerId !== "string" ||
      !boundedCodePattern.test(input.claimOwnerId) ||
      !Number.isSafeInteger(input.claimFence) ||
      (input.claimFence as number) < 0 ||
      (input.toolKind !== "show_catalog" && input.toolKind !== "start_booking")
    ) {
      return null;
    }
    const requiredScope =
      input.toolKind === "show_catalog"
        ? "client_catalog:read"
        : "client_booking:write";
    if (input.requiredScope !== requiredScope) return null;
    const frozenInput = freezeInput(input.toolKind, input.frozenInput);
    if (frozenInput === null) return null;
    return Object.freeze({
      operationId: input.operationId,
      claimToken: input.claimToken,
      claimOwnerId: input.claimOwnerId,
      claimFence: input.claimFence as number,
      toolKind: input.toolKind,
      requiredScope,
      frozenInput,
    });
  } catch {
    return null;
  }
};

const readClaim = (
  value: unknown,
  expectedTool: ClientConversationToolKind,
): ClientConversationOperationClaimDetails | null => {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      !genuineClaims.has(value) ||
      !(value instanceof RuntimeConversationOperationClaim)
    ) {
      return null;
    }
    const details = value.details();
    return details.toolKind === expectedTool ? details : null;
  } catch {
    return null;
  }
};

export const createClientConversationOperationAuthority = () => {
  const localClaims = new WeakSet<object>();
  const issuer = Object.freeze({
    issue(
      input: ClientConversationOperationClaimDetails,
    ): ClaimedConversationOperation {
      const details = validClaimInput(input);
      if (details === null)
        throw new Error("client_conversation_claim_invalid");
      const claim = new RuntimeConversationOperationClaim(details);
      localClaims.add(claim);
      return claim as unknown as ClaimedConversationOperation;
    },
  });
  const localRead = (
    value: unknown,
    expectedTool: ClientConversationToolKind,
  ): ClientConversationOperationClaimDetails | null => {
    if (
      typeof value !== "object" ||
      value === null ||
      !localClaims.has(value)
    ) {
      return null;
    }
    return readClaim(value, expectedTool);
  };
  return Object.freeze({
    issuer,
    catalog: Object.freeze({
      read: (claim: ClaimedConversationOperation) =>
        localRead(claim, "show_catalog"),
    }),
    booking: Object.freeze({
      read: (claim: ClaimedConversationOperation) =>
        localRead(claim, "start_booking"),
    }),
  });
};
