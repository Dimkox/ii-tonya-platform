import type {
  ExpertPrincipal,
  ExpertReferralService,
} from "./expert-referral-service.js";
import type { ExpertResidencyService } from "./expert-residency-service.js";
import {
  buildExpertPromptContext,
  validateExpertIntentProposal,
  type ExpertPromptContext,
} from "./expert-prompt-context.js";
import type { ExpertIntentProposal } from "./ports.js";

export interface ExpertProposalSource {
  propose(input: {
    readonly text: string;
    readonly locale: string;
    readonly correlationId: string;
    readonly context: ExpertPromptContext;
  }): Promise<unknown>;
}

export interface ExpertAiIngressCommand {
  readonly principal: ExpertPrincipal;
  readonly text: string;
  readonly locale: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tariffVersionId?: string;
}

export type ExpertAiIngressResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "rejected";
      readonly reasonCode:
        "invalid_shape" | "unsupported_intent" | "unauthorized_scope";
    }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "completed";
      readonly proposalKind: ExpertIntentProposal["kind"];
      readonly result: unknown;
    };

export type ExpertPersonalOfferRead = NonNullable<
  Parameters<typeof buildExpertPromptContext>[0]["personalOffers"]
>;

export interface ExpertAiIngressService {
  withPersonalOffers?(reads: ExpertPersonalOfferRead): ExpertAiIngressService;
  handle(command: ExpertAiIngressCommand): Promise<ExpertAiIngressResult>;
}

const boundedText = (value: string, max: number): boolean =>
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

export const createExpertAiIngressService = (deps: {
  readonly enabled: boolean;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly source: ExpertProposalSource;
  readonly personalOffers?: ExpertPersonalOfferRead;
}): ExpertAiIngressService => {
  const captured = Object.freeze({ ...deps });
  return {
    withPersonalOffers(reads) {
      return createExpertAiIngressService({
        ...captured,
        personalOffers: reads,
      });
    },
    async handle(rawCommand) {
      const deps = captured;
      const command = Object.freeze({
        ...rawCommand,
        principal: Object.freeze({ ...rawCommand.principal }),
      });
      if (!deps.enabled) return { kind: "disabled" };
      if (
        !command.principal.authenticated ||
        !boundedText(command.text, 4_096) ||
        !boundedText(command.locale, 32) ||
        !boundedText(command.correlationId, 128) ||
        !boundedText(command.idempotencyKey, 128)
      ) {
        return { kind: "forbidden" };
      }

      let contextResult;
      try {
        contextResult = await buildExpertPromptContext({
          principal: command.principal,
          referrals: deps.referrals,
          residency: deps.residency,
          ...(deps.personalOffers
            ? { personalOffers: deps.personalOffers }
            : {}),
          ...(command.tariffVersionId === undefined
            ? {}
            : { tariffVersionId: command.tariffVersionId }),
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (contextResult.kind !== "ready") return contextResult;

      let proposed: unknown;
      try {
        proposed = await deps.source.propose({
          text: command.text,
          locale: command.locale,
          correlationId: command.correlationId,
          context: contextResult.context,
        });
      } catch {
        return { kind: "unavailable" };
      }
      const validation = validateExpertIntentProposal(proposed);
      if (!validation.valid)
        return { kind: "rejected", reasonCode: validation.reasonCode };
      const proposal = validation.proposal;
      if (
        (proposal.kind === "quote_residency" ||
          proposal.kind === "start_residency_checkout") &&
        (contextResult.context.residencyQuote === undefined ||
          proposal.tariffVersionId !==
            contextResult.context.residencyQuote.tariffVersionId)
      ) {
        return { kind: "rejected", reasonCode: "unauthorized_scope" };
      }

      try {
        const result =
          proposal.kind === "redeem_expert_referral"
            ? await deps.referrals.redeemCode(
                command.principal,
                proposal.code,
                command.idempotencyKey,
              )
            : proposal.kind === "view_referral_summary"
              ? await deps.referrals.summary(command.principal)
              : proposal.kind === "quote_residency"
                ? await deps.residency.quote(
                    command.principal,
                    proposal.tariffVersionId,
                  )
                : await deps.residency.checkout(
                    command.principal,
                    proposal.tariffVersionId,
                    command.idempotencyKey,
                  );
        if (typeof result === "object" && result !== null && "kind" in result) {
          const kind = (result as { readonly kind?: unknown }).kind;
          if (kind === "forbidden") return { kind: "forbidden" };
          if (kind === "disabled") return { kind: "disabled" };
        }
        return { kind: "completed", proposalKind: proposal.kind, result };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
};
