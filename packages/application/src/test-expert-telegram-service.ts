import type { ParticipantSegment } from "./test-expert-segmentation.js";
import { segmentParticipant } from "./test-expert-segmentation.js";
import type { TestExpertTrialMetricEvent } from "./test-expert-trial-metrics.js";

export const TEST_EXPERT_PLACEHOLDER_COPY = Object.freeze({
  version: "test-expert-placeholder-v1",
  sellingActivation: "inactive" as const,
  entry:
    "Тестовый сценарий пока не продаёт услуги. Начнём с короткой анкеты: как к вам обращаться?",
  specialization: "Укажите вашу основную специализацию.",
  segment:
    "В каком качестве вы входите: эксперт, центр/студия/салон или организатор?",
  faq: "Сейчас доступна только техническая анкета и предварительный расчёт тарифа. Продающий прогрев будет активирован отдельно после утверждения текста.",
  limit:
    "Лимит тестового диалога исчерпан. Продолжение через ИИ не отправлено.",
  unavailable:
    "Сейчас безопасный расчёт или расширенный ответ недоступен. Попробуйте позже.",
});

export type TestExpertSessionState =
  | "awaiting_name"
  | "awaiting_specialization"
  | "awaiting_segment"
  | "ready"
  | "qualified"
  | "closed";

export type TestExpertTelegramSession = {
  readonly id?: string;
  readonly version: number;
  readonly state: TestExpertSessionState;
  readonly name?: string;
  readonly specialization?: string;
  readonly segment?: ParticipantSegment;
};

export type TestExpertTelegramScope = {
  readonly botKey: string;
  readonly telegramUserId: string;
  readonly chatId: string;
};

export interface TestExpertTelegramPort {
  load(input: TestExpertTelegramScope): Promise<
    | { readonly kind: "ambiguous" }
    | { readonly kind: "not_found" }
    | { readonly kind: "consent_denied" }
    | {
        readonly kind: "resolved";
        readonly userId: string;
        readonly session: TestExpertTelegramSession | null;
      }
  >;
  deliverDeterministic(
    input: TestExpertTelegramScope & {
      readonly userId: string;
      readonly expectedSessionVersion: number | null;
      readonly nextSession: TestExpertTelegramSession;
      readonly replyText: string;
      readonly copyVersion: string;
      readonly sellingActivation: "inactive";
      readonly trialUnits: 0;
      readonly requestKey: string;
      readonly requestDigest: string;
      readonly correlationId: string;
      readonly occurredAt: string;
    },
  ): Promise<{
    readonly kind: "applied" | "duplicate";
    readonly replay: boolean;
  }>;
  enqueueResidual(
    input: TestExpertTelegramScope & {
      readonly userId: string;
      readonly sessionId: string;
      readonly expectedSessionVersion: number;
      readonly text: string;
      readonly providerCalls: 1;
      readonly requestKey: string;
      readonly requestDigest: string;
      readonly correlationId: string;
      readonly occurredAt: string;
    },
  ): Promise<{
    readonly kind:
      | "applied"
      | "pending"
      | "not_applied"
      | "unknown"
      | "duplicate"
      | "limit_reached";
    readonly providerRequestId?: string;
    readonly replay: boolean;
    readonly redemptionCreated?: boolean;
    readonly reservationCreated?: boolean;
  }>;
}

type QuotePolicy = {
  quote(input: Record<string, unknown>): Promise<{ priceMinor: number }>;
};

type HandleInput = TestExpertTelegramScope & {
  readonly text: string;
  readonly requestKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly occurredAt: string;
};

const entry = /^(?:тест эксперт|\/test_expert)$/iu;
const faq = /^(?:faq|\/faq|помощь|условия)$/iu;
const boundedAnswer = (value: string): string | null => {
  const answer = value.trim();
  return answer.length >= 1 && answer.length <= 256 ? answer : null;
};
const formatRub = (minor: number): string =>
  `${Math.floor(minor / 100)
    .toLocaleString("ru-RU")
    .replaceAll(" ", " ")} ₽`;

export class TestExpertTelegramService {
  constructor(
    private readonly deps: {
      readonly telegram: TestExpertTelegramPort;
      readonly expertPolicy: QuotePolicy | null;
      readonly partnerPolicy: QuotePolicy | null;
      readonly residualEnabled: boolean;
      readonly metrics: { record(event: TestExpertTrialMetricEvent): void };
    },
  ) {}

  async handle(input: HandleInput): Promise<{
    readonly status: "handled" | "unhandled" | "unavailable";
    readonly route?: "deterministic" | "residual";
  }> {
    const text = input.text.trim();
    const context = await this.deps.telegram.load(input);
    if (context.kind === "ambiguous" || context.kind === "consent_denied")
      return { status: "unavailable" };
    if (context.kind === "not_found")
      return entry.test(text)
        ? { status: "unavailable" }
        : { status: "unhandled" };
    if (context.session === null && !entry.test(text))
      return { status: "unhandled" };

    const deterministic = async (
      nextSession: TestExpertTelegramSession,
      replyText: string,
    ) => {
      const delivered = await this.deps.telegram.deliverDeterministic({
        ...input,
        userId: context.userId,
        expectedSessionVersion: context.session?.version ?? null,
        nextSession,
        replyText,
        copyVersion: TEST_EXPERT_PLACEHOLDER_COPY.version,
        sellingActivation: TEST_EXPERT_PLACEHOLDER_COPY.sellingActivation,
        trialUnits: 0,
      });
      if (delivered.replay) this.metric("duplicate_request");
      else {
        this.metric("deterministic_message");
        this.metric("deterministic_offload");
      }
      return { status: "handled" as const, route: "deterministic" as const };
    };

    if (context.session === null) {
      return deterministic(
        { version: 1, state: "awaiting_name" },
        TEST_EXPERT_PLACEHOLDER_COPY.entry,
      );
    }
    const session = context.session;
    const next = (change: Partial<TestExpertTelegramSession>) => ({
      ...session,
      ...change,
      version: session.version + 1,
    });
    if (session.state === "awaiting_name") {
      const name = boundedAnswer(text);
      if (name === null)
        return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.entry);
      return deterministic(
        next({ state: "awaiting_specialization", name }),
        TEST_EXPERT_PLACEHOLDER_COPY.specialization,
      );
    }
    if (session.state === "awaiting_specialization") {
      const specialization = boundedAnswer(text);
      if (specialization === null)
        return deterministic(
          session,
          TEST_EXPERT_PLACEHOLDER_COPY.specialization,
        );
      return deterministic(
        next({ state: "awaiting_segment", specialization }),
        TEST_EXPERT_PLACEHOLDER_COPY.segment,
      );
    }
    if (session.state === "awaiting_segment") {
      let segment: ParticipantSegment;
      try {
        segment = segmentParticipant(text.toLowerCase() as never);
      } catch {
        return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.segment);
      }
      const policy =
        segment === "EXPERT" ? this.deps.expertPolicy : this.deps.partnerPolicy;
      if (policy === null)
        return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.unavailable);
      try {
        const quote = await policy.quote({ segment });
        return deterministic(
          next({ state: "ready", segment }),
          `Предварительный тариф: ${formatRub(quote.priceMinor)}. ${TEST_EXPERT_PLACEHOLDER_COPY.faq}`,
        );
      } catch {
        return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.unavailable);
      }
    }
    if (session.state === "closed") return { status: "unhandled" };
    if (faq.test(text))
      return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.faq);
    if (!session.id) return { status: "unavailable" };
    if (!this.deps.residualEnabled)
      return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.unavailable);
    const result = await this.deps.telegram.enqueueResidual({
      ...input,
      userId: context.userId,
      sessionId: session.id,
      expectedSessionVersion: session.version,
      providerCalls: 1,
    });
    if (result.redemptionCreated) this.metric("redemption_created");
    if (result.replay || result.kind === "duplicate") {
      this.metric("duplicate_request");
      return { status: "handled", route: "residual" };
    }
    if (result.kind === "limit_reached") {
      this.metric("cap_rejected");
      return deterministic(session, TEST_EXPERT_PLACEHOLDER_COPY.limit);
    }
    if (result.reservationCreated) this.metric("units_reserved");
    if (result.kind === "applied") {
      this.metric("units_consumed");
      this.metric("provider_outcome", { outcome: "applied" });
    } else if (result.kind === "not_applied") {
      this.metric("units_released");
      this.metric("provider_outcome", { outcome: "not_applied" });
    } else if (result.kind === "unknown") {
      this.metric("unknown_outcome");
      this.metric("provider_outcome", { outcome: "unknown" });
    }
    return { status: "handled", route: "residual" };
  }

  private metric(
    name: TestExpertTrialMetricEvent["name"],
    labels?: Readonly<Record<string, string>>,
  ): void {
    this.deps.metrics.record({ name, value: 1, ...(labels ? { labels } : {}) });
  }
}
