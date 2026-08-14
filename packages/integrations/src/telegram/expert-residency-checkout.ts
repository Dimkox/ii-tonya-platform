import { randomUUID } from "node:crypto";
import {
  inspectResidencyCheckoutCallback,
  issueResidencyCheckoutCallback,
  ResidencyCheckoutCallbackVerificationError,
  type ResidencyCheckoutStateStore,
  type ResidencyCheckoutStoredOutcome,
} from "./residency-checkout-callback-token.js";

const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_LEASE_MS = 5 * 60 * 1_000;

export interface ExpertTelegramCheckoutPrincipal {
  readonly userId: string;
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly timezone: string;
}

interface ResidencyCheckoutService {
  checkout(
    principal: {
      readonly authenticated: true;
      readonly userId: string;
      readonly expertId: string;
    },
    tariffVersionId: string,
    idempotencyKey: string,
  ): Promise<
    | { readonly kind: "forbidden" | "disabled" }
    | {
        readonly id: string;
        readonly status: "payment_pending" | "expired";
        readonly payment?: {
          readonly kind: "created";
          readonly paymentId: string;
          readonly checkoutUrl: string;
        };
      }
  >;
}

export type ExpertTelegramCheckoutResult =
  | {
      readonly kind: "ready";
      readonly tokenHash: string;
      readonly checkoutUrl: string;
      readonly replay: boolean;
    }
  | {
      readonly kind: "unknown" | "processing";
      readonly tokenHash: string;
      readonly replay: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly tokenHash?: string;
      readonly replay: boolean;
    };

export interface ExpertTelegramCheckoutCapability {
  issue(input: {
    readonly principal: ExpertTelegramCheckoutPrincipal;
    readonly tariffVersionId: string;
    readonly idempotencyKey: string;
  }): Promise<string>;
  process(input: {
    readonly data: string;
    readonly principal: ExpertTelegramCheckoutPrincipal;
  }): Promise<ExpertTelegramCheckoutResult>;
}

const validCheckoutUrl = (value: string): boolean => {
  if (value.length < 1 || value.length > 2048 || /\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

export function createExpertResidencyCheckoutCapability(deps: {
  readonly secret: Uint8Array;
  readonly store: ResidencyCheckoutStateStore;
  readonly residency: ResidencyCheckoutService;
  readonly now?: () => Date;
  readonly newFence?: () => string;
  readonly ttlMs?: number;
  readonly leaseMs?: number;
}): ExpertTelegramCheckoutCapability {
  const now = deps.now ?? (() => new Date());
  const newFence = deps.newFence ?? randomUUID;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  if (
    deps.secret.byteLength < 32 ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 60_000 ||
    ttlMs > DEFAULT_TTL_MS ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1_000 ||
    leaseMs > DEFAULT_LEASE_MS
  ) {
    throw new Error("invalid_expert_telegram_checkout_capability");
  }

  const finish = async (
    tokenHash: string,
    fence: string,
    outcome: ResidencyCheckoutStoredOutcome,
    at: Date,
  ): Promise<ExpertTelegramCheckoutResult> => {
    const recorded = await deps.store.recordCheckoutOutcome(
      tokenHash,
      fence,
      outcome,
      at,
    );
    if (!recorded) {
      return { kind: "processing", tokenHash, replay: false };
    }
    return outcome.kind === "ready"
      ? {
          kind: "ready",
          tokenHash,
          checkoutUrl: outcome.checkoutUrl,
          replay: false,
        }
      : { kind: outcome.kind, tokenHash, replay: false };
  };

  return {
    async issue(input) {
      const at = now();
      return issueResidencyCheckoutCallback(
        {
          expertId: input.principal.expertId,
          telegramUserId: input.principal.telegramUserId,
          tariffVersionId: input.tariffVersionId,
          action: "start_residency_checkout",
          expiresAt: new Date(at.getTime() + ttlMs),
        },
        input.idempotencyKey,
        deps.secret,
        deps.store,
      );
    },

    async process(input) {
      const at = now();
      let authenticated: Awaited<
        ReturnType<typeof inspectResidencyCheckoutCallback>
      >;
      try {
        authenticated = await inspectResidencyCheckoutCallback(
          input.data,
          {
            expertId: input.principal.expertId,
            telegramUserId: input.principal.telegramUserId,
          },
          deps.secret,
          deps.store,
          at,
        );
      } catch (error) {
        if (error instanceof ResidencyCheckoutCallbackVerificationError) {
          return { kind: "unavailable", replay: true };
        }
        throw error;
      }
      const leaseUntil = new Date(
        Math.min(
          authenticated.claims.expiresAt.getTime(),
          at.getTime() + leaseMs,
        ),
      );
      if (leaseUntil.getTime() <= at.getTime()) {
        return {
          kind: "unavailable",
          tokenHash: authenticated.tokenHash,
          replay: true,
        };
      }
      const claim = await deps.store.claimCheckout(
        authenticated.tokenHash,
        authenticated.claims,
        at,
        leaseUntil,
        newFence(),
      );
      if (claim === null) {
        return {
          kind: "unavailable",
          tokenHash: authenticated.tokenHash,
          replay: true,
        };
      }
      if (claim.kind === "processing") {
        return { kind: "processing", tokenHash: claim.tokenHash, replay: true };
      }
      if (claim.kind === "replay") {
        return claim.outcome.kind === "ready"
          ? {
              kind: "ready",
              tokenHash: claim.tokenHash,
              checkoutUrl: claim.outcome.checkoutUrl,
              replay: true,
            }
          : {
              kind: claim.outcome.kind,
              tokenHash: claim.tokenHash,
              replay: true,
            };
      }

      let outcome: ResidencyCheckoutStoredOutcome;
      try {
        const checkout = await deps.residency.checkout(
          {
            authenticated: true,
            userId: input.principal.userId,
            expertId: input.principal.expertId,
          },
          claim.claims.tariffVersionId,
          claim.tokenHash,
        );
        const checkoutUrl =
          "kind" in checkout ? undefined : checkout.payment?.checkoutUrl;
        outcome =
          checkoutUrl !== undefined && validCheckoutUrl(checkoutUrl)
            ? { kind: "ready", checkoutUrl }
            : { kind: "unavailable" };
      } catch {
        outcome = { kind: "unknown" };
      }
      return finish(claim.tokenHash, claim.fence, outcome, now());
    },
  };
}
