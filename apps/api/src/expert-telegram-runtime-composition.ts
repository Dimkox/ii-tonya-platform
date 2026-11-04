/**
 * SCRUM-513: production composition of the expert Telegram query ingress
 * (/schedule, /client, /stats, menu, 🔄 reschedule).
 *
 * Built only when EXPERT_TELEGRAM_QUERIES_ENABLED=true. Fails closed when any
 * required input is missing. Financial views, referral mutations and checkout
 * are not wired here: those flags must stay off (startup fails otherwise).
 * Reschedule (rs1/rs2) is wired only with EXPERT_TELEGRAM_RESCHEDULE_ENABLED=true
 * (default off).
 */
import {
  createBookingService,
  createExpertTelegramQueryService,
} from "@ii-tonya/application";
import type { loadEnv } from "@ii-tonya/config";
import {
  PostgresBookingRepository,
  PostgresExpertSessionRepository,
  PostgresExpertTelegramQueryRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  ClientViewCallbackVerificationError,
  TelegramAdapter,
  authenticateClientViewCallback,
  issueClientViewCallback,
  type ExpertTelegramIngressFactoryDependencies,
  type TelegramTransport,
} from "@ii-tonya/integrations";

type RuntimeConfig = ReturnType<typeof loadEnv>;

export type ExpertTelegramRuntimeComposition = Omit<
  ExpertTelegramIngressFactoryDependencies,
  | "enabled"
  | "financialViewsEnabled"
  | "referralMutationsEnabled"
  | "checkoutReadiness"
  | "referral"
  | "residency"
> &
  Required<
    Pick<ExpertTelegramIngressFactoryDependencies, "referral" | "residency">
  >;

const TELEGRAM_BASE_URL = new URL("https://api.telegram.org");
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Minimal JSON POST transport for sendMessage and answerCallbackQuery. */
export const createExpertTelegramFetchTransport = (
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): TelegramTransport => ({
  async request(request) {
    if (
      request.method !== "POST" ||
      request.url.origin !== TELEGRAM_BASE_URL.origin
    )
      throw new Error("expert_telegram_request_invalid");
    const response = await fetchImpl(request.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
      return { status: response.status, body: null };
    let body: unknown = null;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  },
});

const decodeSecret = (value: string | undefined): Uint8Array | undefined => {
  if (value === undefined || !/^[A-Za-z0-9_-]{43,128}$/u.test(value))
    return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength >= 32 ? new Uint8Array(bytes) : undefined;
};

export const createExpertTelegramRuntimeComposition = (input: {
  readonly config: RuntimeConfig;
  readonly db: DrizzleDb;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: { now(): Date };
  readonly logger?: { error(entry: unknown): void };
}): ExpertTelegramRuntimeComposition | undefined => {
  const { config, db, env } = input;
  if (config.features.expertTelegramQueries !== true) return undefined;
  if (
    config.features.expertTelegramFinancialViews === true ||
    config.features.expertTelegramReferral === true ||
    config.features.expertTelegramCheckout === true
  )
    throw new Error("expert_telegram_runtime_financial_unsupported");
  if (config.features.expertSession !== true || !config.expertSession)
    throw new Error("expert_telegram_runtime_session_required");
  const secret = decodeSecret(env.EXPERT_TELEGRAM_CLIENT_VIEW_SECRET);
  if (secret === undefined)
    throw new Error("expert_telegram_client_view_secret_required");
  const rescheduleFlag = env.EXPERT_TELEGRAM_RESCHEDULE_ENABLED ?? "false";
  if (rescheduleFlag !== "true" && rescheduleFlag !== "false")
    throw new Error("expert_telegram_reschedule_flag_invalid");

  const clock = input.clock ?? { now: () => new Date() };
  const timezone = config.displayTimezone;
  const sessions = new PostgresExpertSessionRepository(
    db,
    config.expertSession.botKey,
  );
  const queryRepository = new PostgresExpertTelegramQueryRepository(db);
  const bookingRepository = new PostgresBookingRepository(db);
  const views = new TelegramAdapter({
    baseUrl: TELEGRAM_BASE_URL,
    botToken: config.expertSession.botToken,
    transport: createExpertTelegramFetchTransport(input.fetch),
    logger: input.logger ?? { error: () => undefined },
    maxBodyBytes: MAX_RESPONSE_BYTES,
  });

  const resolvePrincipal = async (telegramUserId: string) => {
    // Read-only queries keep access for paused experts with native obligations.
    const owner = await sessions.resolveTelegramQueryIdentity(telegramUserId);
    return owner === null
      ? null
      : {
          userId: owner.userId,
          expertId: owner.expertId,
          telegramUserId,
          timezone,
        };
  };

  return {
    resolvePrincipal,
    async authenticateClientView({ data, telegramUserId }) {
      const principal = await resolvePrincipal(telegramUserId);
      if (principal === null) return null;
      try {
        return await authenticateClientViewCallback(
          data,
          telegramUserId,
          {
            telegramUserId,
            expertId: principal.expertId,
            active: true,
            verified: true,
          },
          secret,
          queryRepository,
          clock.now(),
        );
      } catch (error) {
        if (error instanceof ClientViewCallbackVerificationError) return null;
        throw error;
      }
    },
    queries: createExpertTelegramQueryService({
      booking: createBookingService({ repository: bookingRepository, clock }),
      repository: queryRepository,
      clientViewCallbacks: {
        issue: (claims) =>
          issueClientViewCallback(claims, secret, queryRepository),
      },
      clock,
    }),
    views,
    referral: {
      summary: async () => ({ kind: "forbidden" as const }),
      redeemCode: async () => ({ kind: "disabled" as const }),
    },
    residency: {
      listActiveTariffs: async () => ({ kind: "disabled" as const }),
      quote: async () => ({ kind: "disabled" as const }),
    },
    ...(rescheduleFlag === "true"
      ? {
          reschedule: {
            listSlots: (command) =>
              bookingRepository.listExpertRescheduleSlots(command),
            reschedule: (command) =>
              bookingRepository.rescheduleByExpert(command),
          },
        }
      : {}),
  };
};
