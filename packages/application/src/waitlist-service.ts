import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { ClientPrincipal } from "./ports.js";

export type WaitlistRepositoryResult =
  | Readonly<{
      kind: "joined" | "replayed";
      waitlistHandle: `wl1.${string}`;
      position: number;
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "handle_collision" }>;

export interface ProtectedWaitlistRepository {
  join(input: {
    userId: string;
    choiceDigest: `sha256:${string}`;
    idempotencyKey: string;
    waitlistHandle: `wl1.${string}`;
    correlationId: string;
    holdDurationMs: 259_200_000;
  }): Promise<WaitlistRepositoryResult>;
  leave(input: {
    userId: string;
    waitlistHandle: `wl1.${string}`;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<
    Readonly<{ kind: "left" | "replayed" | "not_found" | "conflict" }>
  >;
}

export class WaitlistInvalidRequestError extends Error {
  readonly code = "waitlist_invalid_request";
  constructor() {
    super("waitlist_invalid_request");
    this.name = "WaitlistInvalidRequestError";
  }
}

export class WaitlistConflictError extends Error {
  readonly code = "waitlist_conflict";
  constructor() {
    super("waitlist_conflict");
    this.name = "WaitlistConflictError";
  }
}

export class WaitlistNotFoundError extends Error {
  readonly code = "waitlist_not_found";
  constructor() {
    super("waitlist_not_found");
    this.name = "WaitlistNotFoundError";
  }
}

export interface WaitlistService {
  join(
    principal: ClientPrincipal,
    input: { choiceHandle: string },
  ): Promise<{
    waitlistHandle: `wl1.${string}`;
    position: number;
    replayed: boolean;
  }>;
  leave(
    principal: ClientPrincipal,
    waitlistHandle: string,
  ): Promise<{
    waitlistHandle: `wl1.${string}`;
    state: "cancelled";
    replayed: boolean;
  }>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHOICE = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const WAITLIST = /^wl1\.[A-Za-z0-9_-]{43}$/u;
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function owner(principal: ClientPrincipal): string {
  if (
    principal.authenticated !== true ||
    principal.active !== true ||
    typeof principal.userId !== "string" ||
    !UUID.test(principal.userId)
  ) {
    throw new WaitlistInvalidRequestError();
  }
  return principal.userId;
}

export function createWaitlistService(deps: {
  repository: ProtectedWaitlistRepository;
  generateHandle?: () => `wl1.${string}`;
  newCorrelationId?: () => string;
}): WaitlistService {
  const generateHandle =
    deps.generateHandle ??
    (() => `wl1.${randomBytes(32).toString("base64url")}` as const);
  const correlation = deps.newCorrelationId ?? randomUUID;
  return Object.freeze({
    async join(principal: ClientPrincipal, input: { choiceHandle: string }) {
      const userId = owner(principal);
      if (
        typeof input !== "object" ||
        input === null ||
        Object.keys(input).length !== 1 ||
        !CHOICE.test(input.choiceHandle)
      ) {
        throw new WaitlistInvalidRequestError();
      }
      const choiceDigest = `sha256:${digest(input.choiceHandle)}` as const;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const waitlistHandle = generateHandle();
        if (!WAITLIST.test(waitlistHandle))
          throw new WaitlistInvalidRequestError();
        const result = await deps.repository.join({
          userId,
          choiceDigest,
          idempotencyKey: digest(
            `waitlist-join-v1\0${userId}\0${choiceDigest}`,
          ),
          waitlistHandle,
          correlationId: correlation(),
          holdDurationMs: 259_200_000,
        });
        if (result.kind === "handle_collision") continue;
        if (result.kind === "not_found") throw new WaitlistNotFoundError();
        if (result.kind === "conflict") throw new WaitlistConflictError();
        return {
          waitlistHandle: result.waitlistHandle,
          position: result.position,
          replayed: result.kind === "replayed",
        };
      }
      throw new WaitlistConflictError();
    },
    async leave(principal: ClientPrincipal, waitlistHandle: string) {
      const userId = owner(principal);
      if (!WAITLIST.test(waitlistHandle))
        throw new WaitlistInvalidRequestError();
      const result = await deps.repository.leave({
        userId,
        waitlistHandle: waitlistHandle as `wl1.${string}`,
        idempotencyKey: digest(
          `waitlist-leave-v1\0${userId}\0${waitlistHandle}`,
        ),
        correlationId: correlation(),
      });
      if (result.kind === "not_found") throw new WaitlistNotFoundError();
      if (result.kind === "conflict") throw new WaitlistConflictError();
      return {
        waitlistHandle: waitlistHandle as `wl1.${string}`,
        state: "cancelled" as const,
        replayed: result.kind === "replayed",
      };
    },
  });
}
