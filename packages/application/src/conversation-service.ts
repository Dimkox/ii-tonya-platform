import {
  isActionableSafetyContact,
  type SafetyContact,
  type SafetyRisk,
} from "@ii-tonya/domain";

import type {
  CanonicalOutboundDelivery,
  ConversationDependencies,
  ConversationResult,
  ConversationService,
  HandleInboundCommand,
  InboundCompletionOutcome,
  IntentAuthorizationScope,
  IntentProposal,
  OutboundDeliveryResult,
  VerifiedSafetyContact,
} from "./ports.js";
import type { ClientCommercialPolicy } from "./client-commercial-policy.js";

const MAX_INBOUND_TEXT_LENGTH = 4_096;
const MAX_ANSWER_TEXT_LENGTH = 2_000;
const MAX_AUTHORIZATION_SCOPE_VALUES = 128;
const stableKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const locale = /^[a-z]{2}(?:-[A-Z]{2})?$/u;
const countryCode = /^[A-Z]{2}$/u;
const boundedCode = /^[a-z][a-z0-9_-]{0,63}$/u;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const instructionOverride =
  /\b(?:ignore|override|forget|disregard)\b[\s\S]{0,48}\b(?:instruction|prompt|rule)s?\b/iu;
const arbitraryUrl = /\b(?:https?|ftp):\/\/|www\./iu;
const safetyBypass =
  /\b(?:disable|bypass|skip|ignore|without)\b[\s\S]{0,48}\b(?:safety|guard|escalation|handoff)\b/iu;
const providerCredential =
  /(?:^|[^A-Za-z0-9])(?:api[_\s-]?key|access[_\s-]?token|client[_\s-]?secret|webhook[_\s-]?secret|bearer\s+[A-Za-z0-9._-]+)\b/iu;
const unauthorizedCapability =
  /\b(?:shell[_\s-]?exec|execute[_\s-]?tool|call[_\s-]?tool|curl|invoke-webrequest|stripe|yookassa|paypal|cloudpayments|select\s+[\s\S]{1,128}?\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+(?:table|database))\b/iu;
const crossClientDisclosure =
  /\b(?:another|other)\s+client(?:'s)?\b|\bclient[_\s-]?record\b|\bcross[_\s-]?client\b/iu;
const persistentToolInstruction =
  /\bcatalog\b[\s\S]{0,128}\b(?:persistent\s+)?(?:tool|instruction|call_tool|execute)\b/iu;
const unapprovedDestination =
  /\b(?:meeting|audio|conference|call)\b[\s\S]{0,96}\b(?:https?|ftp):\/\//iu;
const safetyRisks = new Set<SafetyRisk>([
  "self_harm",
  "violence",
  "medical",
  "abuse",
  "urgent",
  "uncertain",
]);

type IntentRejectionReason =
  | "instruction_override"
  | "arbitrary_url"
  | "unauthorized_capability"
  | "provider_credential"
  | "safety_bypass"
  | "cross_client_disclosure"
  | "persistent_tool_instruction"
  | "unauthorized_scope"
  | "unapproved_destination"
  | "invalid_shape";

export type IntentProposalValidation =
  | { readonly accepted: true; readonly proposal: IntentProposal }
  | { readonly accepted: false; readonly reasonCode: IntentRejectionReason };

export class ConversationServiceError extends Error {
  readonly retryable: boolean;

  constructor(readonly code: "invalid_input" | "dependency_unavailable") {
    super(
      code === "invalid_input"
        ? "Invalid conversation input"
        : "Conversation dependency unavailable",
    );
    this.name = "ConversationServiceError";
    this.retryable = code === "dependency_unavailable";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
};

const validateAuthorizationScope = (
  value: unknown,
): IntentAuthorizationScope | null => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["allowedExpertIds", "allowedServiceCodes"]) ||
    !Array.isArray(value.allowedExpertIds) ||
    !Array.isArray(value.allowedServiceCodes) ||
    value.allowedExpertIds.length > MAX_AUTHORIZATION_SCOPE_VALUES ||
    value.allowedServiceCodes.length > MAX_AUTHORIZATION_SCOPE_VALUES ||
    !value.allowedExpertIds.every(
      (id): id is string => typeof id === "string" && uuid.test(id),
    ) ||
    !value.allowedServiceCodes.every(
      (code): code is string =>
        typeof code === "string" && boundedCode.test(code),
    ) ||
    new Set(value.allowedExpertIds).size !== value.allowedExpertIds.length ||
    new Set(value.allowedServiceCodes).size !== value.allowedServiceCodes.length
  ) {
    return null;
  }
  return {
    allowedExpertIds: [...value.allowedExpertIds],
    allowedServiceCodes: [...value.allowedServiceCodes],
  };
};

const capabilityRejection = (
  values: readonly string[],
): IntentRejectionReason | null => {
  const text = values.join("\n");
  if (crossClientDisclosure.test(text)) return "cross_client_disclosure";
  if (persistentToolInstruction.test(text)) {
    return "persistent_tool_instruction";
  }
  if (unapprovedDestination.test(text)) return "unapproved_destination";
  if (instructionOverride.test(text)) return "instruction_override";
  if (arbitraryUrl.test(text)) return "arbitrary_url";
  if (safetyBypass.test(text)) return "safety_bypass";
  if (providerCredential.test(text)) return "provider_credential";
  if (unauthorizedCapability.test(text)) return "unauthorized_capability";
  return null;
};

const validateIntentProposalUnsafe = (
  value: unknown,
  authorization?: unknown,
): IntentProposalValidation => {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return { accepted: false, reasonCode: "invalid_shape" };
  }
  const earlyRejection = capabilityRejection(
    Object.values(value).filter(
      (part): part is string => typeof part === "string",
    ),
  );
  if (earlyRejection) {
    return { accepted: false, reasonCode: earlyRejection };
  }

  let proposal: IntentProposal;
  if (value.kind === "answer") {
    if (
      !hasExactKeys(value, ["kind", "text"]) ||
      typeof value.text !== "string" ||
      value.text.trim().length === 0 ||
      value.text.length > MAX_ANSWER_TEXT_LENGTH ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value.text)
    ) {
      return { accepted: false, reasonCode: "invalid_shape" };
    }
    proposal = { kind: "answer", text: value.text };
  } else if (value.kind === "show_catalog") {
    if (
      !hasExactKeys(value, ["kind"], ["serviceCode"]) ||
      (value.serviceCode !== undefined &&
        (typeof value.serviceCode !== "string" ||
          !boundedCode.test(value.serviceCode)))
    ) {
      return { accepted: false, reasonCode: "invalid_shape" };
    }
    proposal =
      value.serviceCode === undefined
        ? { kind: "show_catalog" }
        : { kind: "show_catalog", serviceCode: value.serviceCode as string };
  } else if (value.kind === "start_booking") {
    if (
      !hasExactKeys(value, ["kind", "expertId"]) ||
      typeof value.expertId !== "string" ||
      !uuid.test(value.expertId)
    ) {
      return { accepted: false, reasonCode: "invalid_shape" };
    }
    proposal = { kind: "start_booking", expertId: value.expertId };
  } else if (value.kind === "human_handoff") {
    if (
      !hasExactKeys(value, ["kind", "reasonCode"]) ||
      typeof value.reasonCode !== "string" ||
      !boundedCode.test(value.reasonCode)
    ) {
      return { accepted: false, reasonCode: "invalid_shape" };
    }
    proposal = { kind: "human_handoff", reasonCode: value.reasonCode };
  } else {
    return { accepted: false, reasonCode: "invalid_shape" };
  }

  const rejection = capabilityRejection(
    Object.values(proposal).filter(
      (part): part is string => typeof part === "string",
    ),
  );
  if (rejection) return { accepted: false, reasonCode: rejection };
  const authorized = validateAuthorizationScope(authorization);
  if (authorized === null) {
    return { accepted: false, reasonCode: "unauthorized_scope" };
  }
  if (
    proposal.kind === "start_booking" &&
    !authorized.allowedExpertIds.includes(proposal.expertId)
  ) {
    return { accepted: false, reasonCode: "unauthorized_scope" };
  }
  if (
    proposal.kind === "show_catalog" &&
    proposal.serviceCode !== undefined &&
    !authorized.allowedServiceCodes.includes(proposal.serviceCode)
  ) {
    return { accepted: false, reasonCode: "unauthorized_scope" };
  }
  return { accepted: true, proposal };
};

export const validateIntentProposal = (
  value: unknown,
  authorization?: unknown,
): IntentProposalValidation => {
  try {
    return validateIntentProposalUnsafe(value, authorization);
  } catch {
    return { accepted: false, reasonCode: "invalid_shape" };
  }
};

const validIsoInstant = (value: string): boolean =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const validateInbound = (command: HandleInboundCommand): void => {
  if (
    !isRecord(command) ||
    !hasExactKeys(command, [
      "provider",
      "providerEventId",
      "providerMessageId",
      "userId",
      "text",
      "locale",
      "countryCode",
      "regionCode",
      "ageBand",
      "occurredAt",
      "correlationId",
    ]) ||
    typeof command.provider !== "string" ||
    !stableKey.test(command.provider) ||
    typeof command.providerEventId !== "string" ||
    !stableKey.test(command.providerEventId) ||
    typeof command.providerMessageId !== "string" ||
    !stableKey.test(command.providerMessageId) ||
    typeof command.userId !== "string" ||
    !stableKey.test(command.userId) ||
    typeof command.text !== "string" ||
    command.text.trim().length === 0 ||
    command.text.length > MAX_INBOUND_TEXT_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(
      command.text,
    ) ||
    typeof command.locale !== "string" ||
    !locale.test(command.locale) ||
    typeof command.countryCode !== "string" ||
    !countryCode.test(command.countryCode) ||
    (command.regionCode !== null &&
      (typeof command.regionCode !== "string" ||
        command.regionCode.length === 0 ||
        command.regionCode.length > 64 ||
        !stableKey.test(command.regionCode))) ||
    !["minor", "adult", "unknown"].includes(command.ageBand) ||
    typeof command.occurredAt !== "string" ||
    !validIsoInstant(command.occurredAt) ||
    typeof command.correlationId !== "string" ||
    !stableKey.test(command.correlationId)
  ) {
    throw new ConversationServiceError("invalid_input");
  }
};

const validateOutbound = (event: CanonicalOutboundDelivery): void => {
  if (
    !isRecord(event) ||
    !hasExactKeys(event, [
      "kind",
      "provider",
      "providerEventId",
      "providerMessageId",
      "userId",
      "occurredAt",
      "correlationId",
      "status",
    ]) ||
    event.kind !== "outbound_delivery" ||
    event.provider !== "selarti" ||
    typeof event.providerEventId !== "string" ||
    !stableKey.test(event.providerEventId) ||
    typeof event.providerMessageId !== "string" ||
    !stableKey.test(event.providerMessageId) ||
    typeof event.userId !== "string" ||
    !stableKey.test(event.userId) ||
    typeof event.occurredAt !== "string" ||
    !validIsoInstant(event.occurredAt) ||
    typeof event.correlationId !== "string" ||
    !stableKey.test(event.correlationId) ||
    typeof event.status !== "string" ||
    ![
      "accepted",
      "queued",
      "sent",
      "delivered",
      "failed",
      "ambiguous",
    ].includes(event.status)
  ) {
    throw new ConversationServiceError("invalid_input");
  }
};

const dependencyFailure = (): ConversationServiceError =>
  new ConversationServiceError("dependency_unavailable");

interface RuntimeConfig {
  readonly now: Date;
  readonly handoffOwnerId: string;
  readonly acknowledgeBy: Date;
  readonly approvedSafetyContactIds: ReadonlySet<string>;
}

const readRuntimeConfig = (deps: ConversationDependencies): RuntimeConfig => {
  if (
    typeof deps.handoffOwnerId !== "string" ||
    !uuid.test(deps.handoffOwnerId) ||
    !Number.isSafeInteger(deps.handoffAcknowledgeWithinMs) ||
    deps.handoffAcknowledgeWithinMs <= 0 ||
    deps.handoffAcknowledgeWithinMs > 86_400_000 ||
    !Array.isArray(deps.approvedSafetyContactIds) ||
    !deps.approvedSafetyContactIds.every(
      (id) => typeof id === "string" && stableKey.test(id),
    ) ||
    new Set(deps.approvedSafetyContactIds).size !==
      deps.approvedSafetyContactIds.length ||
    !["disabled", "provider_delivery_event"].includes(deps.outboundBillingMode)
  ) {
    throw dependencyFailure();
  }
  try {
    const now = deps.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw dependencyFailure();
    }
    const stableNow = new Date(now.getTime());
    const acknowledgeBy = new Date(
      stableNow.getTime() + deps.handoffAcknowledgeWithinMs,
    );
    if (!Number.isFinite(acknowledgeBy.getTime())) {
      throw dependencyFailure();
    }
    return {
      now: stableNow,
      handoffOwnerId: deps.handoffOwnerId,
      acknowledgeBy,
      approvedSafetyContactIds: new Set(deps.approvedSafetyContactIds),
    };
  } catch {
    throw dependencyFailure();
  }
};

const isVerifiedSafetyContact = (
  value: SafetyContact,
  command: HandleInboundCommand,
  risk: SafetyRisk,
  runtime: RuntimeConfig,
): boolean => {
  try {
    return (
      runtime.approvedSafetyContactIds.has(value.id) &&
      stableKey.test(value.id) &&
      value.label.trim().length > 0 &&
      value.label.length <= 128 &&
      !arbitraryUrl.test(value.label) &&
      !/[\u0000-\u001F\u007F-\u009F]/u.test(value.label) &&
      boundedCode.test(value.channel) &&
      isActionableSafetyContact(value) &&
      value.countryCode.trim().toUpperCase() === command.countryCode &&
      (value.regionCode === null ||
        value.regionCode.trim().toUpperCase() === command.regionCode) &&
      Array.isArray(value.ageBands) &&
      value.ageBands.includes(command.ageBand) &&
      Array.isArray(value.riskTypes) &&
      value.riskTypes.includes(risk) &&
      value.verifiedAt instanceof Date &&
      Number.isFinite(value.verifiedAt.getTime()) &&
      value.validUntil instanceof Date &&
      Number.isFinite(value.validUntil.getTime()) &&
      value.verifiedAt.getTime() <= runtime.now.getTime() &&
      value.validUntil.getTime() >= runtime.now.getTime() &&
      /^https:\/\/[A-Za-z0-9.-]+(?:\/[^\s@]*)?$/u.test(value.sourceUrl) &&
      value.owner.trim().length > 0 &&
      value.owner.length <= 128
    );
  } catch {
    return false;
  }
};

const selectSafetyContacts = async (
  deps: ConversationDependencies,
  runtime: RuntimeConfig,
  command: HandleInboundCommand,
  reasonCode: SafetyRisk | "classifier_unavailable",
): Promise<{
  readonly contacts: readonly VerifiedSafetyContact[];
  readonly directoryState: "fresh" | "no_fresh_contact" | "unavailable";
}> => {
  const risk =
    reasonCode === "classifier_unavailable" ? "uncertain" : reasonCode;
  try {
    const candidates = await deps.safetyDirectory.list({
      countryCode: command.countryCode,
      regionCode: command.regionCode,
      ageBand: command.ageBand,
      risk,
      at: runtime.now,
    });
    const contacts = candidates
      .filter((candidate) =>
        isVerifiedSafetyContact(candidate, command, risk, runtime),
      )
      .map(({ id, label, channel, value }) => ({
        id,
        label,
        channel,
        value,
      }));
    return {
      contacts,
      directoryState: contacts.length > 0 ? "fresh" : "no_fresh_contact",
    };
  } catch {
    return { contacts: [], directoryState: "unavailable" };
  }
};

const handleSafety = async (
  deps: ConversationDependencies,
  runtime: RuntimeConfig,
  command: HandleInboundCommand,
  reasonCode: SafetyRisk | "classifier_unavailable",
): Promise<ConversationResult> => {
  const occurredAt = new Date(command.occurredAt);
  const directory = await selectSafetyContacts(
    deps,
    runtime,
    command,
    reasonCode,
  );
  try {
    const accepted = await deps.safetyHandoff.accept({
      provider: command.provider,
      providerEventId: command.providerEventId,
      providerMessageId: command.providerMessageId,
      userId: command.userId,
      occurredAt,
      correlationId: command.correlationId,
      messageClass: "safety",
      reasonCode,
      ownerId: runtime.handoffOwnerId,
      acknowledgeBy: runtime.acknowledgeBy,
      contacts: directory.contacts,
      directoryState: directory.directoryState,
    });
    return accepted.kind === "duplicate"
      ? { kind: "duplicate", chargedMessages: 0 }
      : { kind: "human_handoff", reasonCode, chargedMessages: 0 };
  } catch {
    throw dependencyFailure();
  }
};

const completeInbound = async (
  deps: ConversationDependencies,
  command: HandleInboundCommand,
  messageEventId: string,
  outcome: InboundCompletionOutcome,
  billingPolicy: "package" | "free",
): Promise<ConversationResult> => {
  try {
    const completed = await deps.messageRepository.completeInbound({
      messageEventId,
      userId: command.userId,
      correlationId: command.correlationId,
      outcome,
      billingPolicy,
    });
    if (completed.kind === "retry") {
      throw new Error("Unexpected retry for a chargeable outcome");
    }
    return completed.kind === "duplicate"
      ? { kind: "duplicate", chargedMessages: 0 }
      : completed.result;
  } catch {
    throw dependencyFailure();
  }
};

const completeNoPackage = async (
  deps: ConversationDependencies,
  command: HandleInboundCommand,
  messageEventId: string,
): Promise<ConversationResult | { readonly kind: "retry" }> => {
  try {
    const completed = await deps.messageRepository.completeInbound({
      messageEventId,
      userId: command.userId,
      correlationId: command.correlationId,
      outcome: {
        kind: "no_package",
        topic: "client.no_package",
        payload: {},
      },
      billingPolicy: "package",
    });
    if (completed.kind === "retry") {
      return { kind: "retry" };
    }
    return completed.kind === "duplicate"
      ? { kind: "duplicate", chargedMessages: 0 }
      : completed.result;
  } catch {
    throw dependencyFailure();
  }
};

export const createConversationService = (
  deps: ConversationDependencies,
): ConversationService => ({
  async handleInbound(command): Promise<ConversationResult> {
    validateInbound(command);
    const runtime = readRuntimeConfig(deps);

    let risk: "ordinary" | SafetyRisk;
    try {
      const deterministic: unknown = deps.deterministicSafety.detect(
        command.text,
      );
      if (
        deterministic !== null &&
        !safetyRisks.has(deterministic as SafetyRisk)
      ) {
        throw new Error("Invalid deterministic safety result");
      }
      const classified: unknown =
        deterministic ?? (await deps.typedSafety.classify(command.text));
      if (
        classified !== "ordinary" &&
        !safetyRisks.has(classified as SafetyRisk)
      ) {
        throw new Error("Invalid typed safety result");
      }
      risk = classified as "ordinary" | SafetyRisk;
    } catch {
      return handleSafety(deps, runtime, command, "classifier_unavailable");
    }
    if (risk !== "ordinary") {
      return handleSafety(deps, runtime, command, risk);
    }

    let billingPolicy: "package" | "free" = "package";
    try {
      const policy: ClientCommercialPolicy =
        deps.clientCommercialPolicy === undefined
          ? "legacy_package_v1"
          : await deps.clientCommercialPolicy.resolveOrAssign({
              userId: command.userId,
              allowV2Admission: deps.clientFreeAccessV2Enabled === true,
            });
      billingPolicy = policy === "free_client_v2" ? "free" : "package";
    } catch {
      throw dependencyFailure();
    }

    let prepared;
    try {
      prepared = await deps.messageRepository.prepareInbound({
        provider: command.provider,
        externalEventId: command.providerEventId,
        externalMessageId: command.providerMessageId,
        userId: command.userId,
        messageClass: "ordinary_inbound",
        occurredAt: new Date(command.occurredAt),
        correlationId: command.correlationId,
      });
    } catch {
      throw dependencyFailure();
    }
    if (prepared.kind === "duplicate") {
      return { kind: "duplicate", chargedMessages: 0 };
    }
    if (!prepared.packageAvailable && billingPolicy === "package") {
      const completion = await completeNoPackage(
        deps,
        command,
        prepared.messageEventId,
      );
      if (completion.kind !== "retry") {
        return completion;
      }
    }

    let authorization: IntentAuthorizationScope;
    try {
      const candidate: unknown = await deps.intentAuthorization.scopeFor({
        userId: command.userId,
        correlationId: command.correlationId,
      });
      const validated = validateAuthorizationScope(candidate);
      if (validated === null) {
        return completeInbound(
          deps,
          command,
          prepared.messageEventId,
          {
            kind: "human_handoff",
            topic: "human_handoff.opened",
            payload: { reasonCode: "unauthorized_scope" },
            ownerId: runtime.handoffOwnerId,
            openedAt: runtime.now,
            acknowledgeBy: runtime.acknowledgeBy,
          },
          billingPolicy,
        );
      }
      authorization = validated;
    } catch {
      return completeInbound(
        deps,
        command,
        prepared.messageEventId,
        {
          kind: "human_handoff",
          topic: "human_handoff.opened",
          payload: { reasonCode: "intent_unavailable" },
          ownerId: runtime.handoffOwnerId,
          openedAt: runtime.now,
          acknowledgeBy: runtime.acknowledgeBy,
        },
        billingPolicy,
      );
    }

    let validation: IntentProposalValidation;
    try {
      const proposal = await deps.intentEngine.propose({
        text: command.text,
        locale: command.locale,
        userId: command.userId,
        correlationId: command.correlationId,
        dataSubjectUserId: command.userId,
        authorization,
      });
      validation = validateIntentProposal(proposal, authorization);
    } catch {
      return completeInbound(
        deps,
        command,
        prepared.messageEventId,
        {
          kind: "human_handoff",
          topic: "human_handoff.opened",
          payload: { reasonCode: "intent_unavailable" },
          ownerId: runtime.handoffOwnerId,
          openedAt: runtime.now,
          acknowledgeBy: runtime.acknowledgeBy,
        },
        billingPolicy,
      );
    }
    if (!validation.accepted) {
      return completeInbound(
        deps,
        command,
        prepared.messageEventId,
        {
          kind: "human_handoff",
          topic: "human_handoff.opened",
          payload: { reasonCode: validation.reasonCode },
          ownerId: runtime.handoffOwnerId,
          openedAt: runtime.now,
          acknowledgeBy: runtime.acknowledgeBy,
        },
        billingPolicy,
      );
    }

    const proposal = validation.proposal;
    if (proposal.kind === "human_handoff") {
      return completeInbound(
        deps,
        command,
        prepared.messageEventId,
        {
          kind: "human_handoff",
          topic: "human_handoff.opened",
          payload: { reasonCode: proposal.reasonCode },
          ownerId: runtime.handoffOwnerId,
          openedAt: runtime.now,
          acknowledgeBy: runtime.acknowledgeBy,
        },
        billingPolicy,
      );
    }

    const outcome: InboundCompletionOutcome =
      proposal.kind === "answer"
        ? {
            kind: "answer",
            topic: "selarti.send",
            payload: { text: proposal.text },
          }
        : proposal.kind === "show_catalog"
          ? {
              kind: "show_catalog",
              topic: "catalog.show",
              payload: {
                allowedServiceCodes: authorization.allowedServiceCodes,
                ...(proposal.serviceCode === undefined
                  ? {}
                  : { serviceCode: proposal.serviceCode }),
              },
            }
          : {
              kind: "start_booking",
              topic: "booking.start",
              payload: { expertId: proposal.expertId },
            };
    return completeInbound(
      deps,
      command,
      prepared.messageEventId,
      outcome,
      billingPolicy,
    );
  },

  async handleOutboundDelivery(event): Promise<OutboundDeliveryResult> {
    validateOutbound(event);
    if (
      !["disabled", "provider_delivery_event"].includes(
        deps.outboundBillingMode,
      )
    ) {
      throw dependencyFailure();
    }
    let isFreeV2 = false;
    try {
      isFreeV2 =
        deps.clientCommercialPolicy !== undefined &&
        (await deps.clientCommercialPolicy.resolveOrAssign({
          userId: event.userId,
          allowV2Admission: deps.clientFreeAccessV2Enabled === true,
        })) === "free_client_v2";
    } catch {
      throw dependencyFailure();
    }
    const charge =
      !isFreeV2 &&
      deps.outboundBillingMode === "provider_delivery_event" &&
      event.status === "delivered";
    let accepted;
    try {
      accepted = await deps.messageRepository.recordOutboundDelivery({
        provider: event.provider,
        externalDeliveryEventId: event.providerEventId,
        providerMessageId: event.providerMessageId,
        userId: event.userId,
        deliveryStatus: event.status,
        occurredAt: new Date(event.occurredAt),
        correlationId: event.correlationId,
        charge,
      });
    } catch {
      throw dependencyFailure();
    }
    if (accepted.kind === "duplicate") {
      return { kind: "duplicate", chargedMessages: 0 };
    }
    if (isFreeV2) {
      return { kind: "free", chargedMessages: 0 };
    }
    if (deps.outboundBillingMode === "disabled") {
      return { kind: "billing_disabled", chargedMessages: 0 };
    }
    if (event.status !== "delivered") {
      return { kind: "not_delivered", chargedMessages: 0 };
    }
    return accepted.packageId === null
      ? { kind: "no_package", chargedMessages: 0 }
      : { kind: "charged", chargedMessages: 1 };
  },
});
