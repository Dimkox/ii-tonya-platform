import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
} from "@ii-tonya/application";
import {
  authenticateExpertCommandCallback,
  CallbackInfrastructureError,
  CallbackVerificationError,
  renderExpertReferralSummary,
  renderExpertResidencyQuote,
  type AuthenticatedExpertCommandCallback,
  type ExpertCommandCallbackClaimsStore,
  type ExpertReferralSummaryTelegramView,
  type ExpertResidencyQuoteTelegramView,
} from "@ii-tonya/integrations";
import type {
  PreparedTelegramCallback,
  TelegramCallbackService,
  TelegramWebhookReceipt,
} from "./routes/telegram-webhook.js";

export type ExpertTelegramServerCommand =
  | Readonly<{
      operation: "redeem_expert_referral";
      objectId: string;
      version: number;
      code: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      operation: "view_referral_summary";
      objectId: string;
      version: number;
      code: ExpertReferralSummaryTelegramView["code"];
    }>
  | Readonly<{
      operation: "quote_residency";
      objectId: string;
      version: number;
      tariffVersionId: string;
      tariffKey: string;
    }>
  | Readonly<{
      operation: "start_residency_checkout";
      objectId: string;
      version: number;
      tariffVersionId: string;
      tariffKey: string;
      idempotencyKey: string;
      providerDeadline: Date;
    }>;

export interface ExpertTelegramBindingPort {
  resolveCurrent(telegramUserId: string): Promise<ExpertTelegramBinding | null>;
}

export type ExpertTelegramBinding = Readonly<{
  telegramUserId: string;
  principal: ExpertPrincipal;
  active: boolean;
  verified: boolean;
}>;

export type ExpertTelegramCommandLeaseResult =
  | Readonly<{
      kind: "acquired";
      leaseId: string;
      principal: ExpertPrincipal;
      command: ExpertTelegramServerCommand;
    }>
  | Readonly<{ kind: "busy" }>
  | Readonly<{ kind: "completed" }>
  | Readonly<{ kind: "rejected" }>;

export interface ExpertTelegramServerCommandPort {
  acquire(input: {
    readonly authenticated: AuthenticatedExpertCommandCallback;
    readonly telegramUserId: string;
    readonly preparedBinding: ExpertTelegramBinding;
    readonly now: Date;
    readonly receipt: TelegramWebhookReceipt;
  }): Promise<ExpertTelegramCommandLeaseResult>;
  complete(leaseId: string): Promise<void>;
  release(leaseId: string): Promise<void>;
}

export type ExpertTelegramCommandOutcome =
  | Readonly<{ kind: "referral_redeemed" }>
  | Readonly<{
      kind: "referral_summary";
      view: ExpertReferralSummaryTelegramView;
    }>
  | Readonly<{
      kind: "residency_quote";
      view: ExpertResidencyQuoteTelegramView;
    }>
  | Readonly<{
      kind: "residency_checkout";
      orderId: string;
      result:
        | Readonly<{ kind: "pending_reconciliation" }>
        | Readonly<{
            kind: "created";
            checkoutUrl: string;
            expiresAt: string;
          }>;
    }>;

export interface ExpertTelegramOutputPort {
  publishOnce(message: {
    readonly receipt: TelegramWebhookReceipt;
    readonly outcomeId: string;
    readonly telegramUserId: string;
    readonly correlationId: string;
    readonly outcome: ExpertTelegramCommandOutcome;
  }): Promise<void>;
}

export interface ExpertTelegramCommandDependencies {
  readonly secret: Uint8Array;
  readonly store: ExpertCommandCallbackClaimsStore;
  readonly clock: { now(): Date };
  readonly bindings: ExpertTelegramBindingPort;
  readonly commands: ExpertTelegramServerCommandPort;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly output: ExpertTelegramOutputPort;
}

const denied = (
  value: unknown,
): value is { readonly kind: "forbidden" | "disabled" } =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  ((value as { kind?: unknown }).kind === "forbidden" ||
    (value as { kind?: unknown }).kind === "disabled");

const callbackInput = (
  update: Readonly<Record<string, unknown>>,
): { telegramUserId: string; token: string } | null => {
  const callback = update.callback_query;
  if (typeof callback !== "object" || callback === null) return null;
  const record = callback as Record<string, unknown>;
  const from = record.from;
  const telegramUserId =
    typeof from === "object" && from !== null
      ? String((from as Record<string, unknown>).id ?? "")
      : "";
  return typeof record.data === "string" &&
    /^[1-9]\d{0,19}$/u.test(telegramUserId)
    ? { telegramUserId, token: record.data }
    : null;
};

const executeCommand = async (
  deps: ExpertTelegramCommandDependencies,
  principal: ExpertPrincipal,
  command: ExpertTelegramServerCommand,
): Promise<ExpertTelegramCommandOutcome> => {
  if (command.operation === "redeem_expert_referral") {
    const result = await deps.referrals.redeemCode(
      principal,
      command.code,
      command.idempotencyKey,
    );
    if (denied(result)) throw new Error("expert_telegram_command_denied");
    return { kind: "referral_redeemed" };
  }
  if (command.operation === "view_referral_summary") {
    const result = await deps.referrals.summary(principal);
    if (denied(result) || result.expertId !== principal.expertId) {
      throw new Error("expert_telegram_command_denied");
    }
    const view: ExpertReferralSummaryTelegramView = {
      code: command.code,
      spendableBalanceMinor: result.spendableBalanceMinor,
      reservedBalanceMinor: result.reservedBalanceMinor,
      debtMinor: result.debtMinor,
      nearestExpiryAt: result.nearestExpiryAt?.toISOString() ?? null,
    };
    renderExpertReferralSummary(view);
    return { kind: "referral_summary", view };
  }
  if (command.operation === "quote_residency") {
    const result = await deps.residency.quote(principal, command.tariffKey);
    if (denied(result) || result.tariffVersionId !== command.tariffVersionId) {
      throw new Error("expert_telegram_command_denied");
    }
    const view: ExpertResidencyQuoteTelegramView = {
      tariffVersionId: result.tariffVersionId,
      displayName: result.displayName,
      description: result.description,
      priceMinor: result.priceMinor,
      currency: result.currency,
      durationSeconds: result.durationSeconds,
      creditMinor: result.creditMinor,
      cashMinor: result.cashMinor,
    };
    renderExpertResidencyQuote(view);
    return { kind: "residency_quote", view };
  }
  const result = await deps.residency.checkout(principal, {
    tariffKey: command.tariffKey,
    idempotencyKey: command.idempotencyKey,
    providerDeadline: command.providerDeadline,
  });
  if (
    denied(result) ||
    result.order.expertId !== principal.expertId ||
    result.order.tariffVersionId !== command.tariffVersionId
  ) {
    throw new Error("expert_telegram_command_denied");
  }
  return {
    kind: "residency_checkout",
    orderId: result.order.orderId,
    result:
      result.payment.kind === "created"
        ? {
            kind: "created",
            checkoutUrl: result.payment.checkoutUrl,
            expiresAt: result.payment.expiresAt,
          }
        : { kind: "pending_reconciliation" },
  };
};

export const createExpertTelegramCommandProcessor = (
  deps: ExpertTelegramCommandDependencies,
): TelegramCallbackService => ({
  async isAuthorizedIdentity(telegramUserId) {
    const binding = await deps.bindings.resolveCurrent(telegramUserId);
    return (
      binding !== null &&
      binding.telegramUserId === telegramUserId &&
      binding.active &&
      binding.verified
    );
  },
  async verifyCallback(update, correlationId) {
    const input = callbackInput(update);
    if (input === null) return false;
    const binding = await deps.bindings.resolveCurrent(input.telegramUserId);
    if (binding === null) return false;
    const authenticated = await authenticateExpertCommandCallback(
      input.token,
      input.telegramUserId,
      {
        telegramUserId: binding.telegramUserId,
        expertId: binding.principal.expertId,
        active: binding.active,
        verified: binding.verified,
      },
      deps.secret,
      deps.store,
      deps.clock.now(),
    );
    const prepared: PreparedTelegramCallback = {
      async execute(receipt) {
        const lease = await deps.commands.acquire({
          authenticated,
          telegramUserId: input.telegramUserId,
          preparedBinding: binding,
          now: deps.clock.now(),
          receipt,
        });
        if (lease.kind === "busy") throw new CallbackInfrastructureError();
        if (lease.kind === "completed" || lease.kind === "rejected") {
          throw new CallbackVerificationError();
        }
        try {
          const outcome = await executeCommand(
            deps,
            lease.principal,
            lease.command,
          );
          await deps.output.publishOnce({
            receipt,
            outcomeId: `expert-command:${authenticated.tokenHash}`,
            telegramUserId: input.telegramUserId,
            correlationId,
            outcome,
          });
          await deps.commands.complete(lease.leaseId);
        } catch (error) {
          await deps.commands.release(lease.leaseId);
          throw error;
        }
      },
    };
    return prepared;
  },
  async process() {
    throw new Error("expert_telegram_callback_required");
  },
});
