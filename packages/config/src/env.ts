import { z } from "zod";

const isPostgresUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hasPostgresProtocol = url.protocol === "postgres:" || url.protocol === "postgresql:";
    return hasPostgresProtocol && url.hostname.length > 0 && url.pathname.length > 1;
  } catch {
    return false;
  }
};

const schema = z.object({
  DATABASE_URL: z.string().refine(
    isPostgresUrl,
    "DATABASE_URL must be a hierarchical postgres: or postgresql: URL with a host and database path",
  ),
  SELARTI_ENABLED: z.literal("false").default("false"),
  PLANERKA_ENABLED: z.literal("false").default("false"),
  TELEGRAM_ENABLED: z.literal("false").default("false"),
  LLM_ENABLED: z.literal("false").default("false"),
  MAKE_PROJECTION_ENABLED: z.literal("false").default("false"),
  GOOGLE_SHEETS_PROJECTION_ENABLED: z.literal("false").default("false"),
  INTENT_MODEL_ENABLED: z.literal("false").default("false"),
  PAYMENTS_ENABLED: z.literal("false").default("false"),
  PAYMENT_PROVIDER: z.literal("disabled").default("disabled"),
  LLM_PROVIDER: z.literal("disabled").default("disabled"),
  MINOR_ONBOARDING_ENABLED: z.literal("false").default("false"),
  RAW_CONVERSATION_LOGGING: z.enum(["true", "false"]).default("false"),
  DISPLAY_TIMEZONE: z.string().default("Europe/Moscow"),
}).passthrough();

export type RuntimeConfig = {
  databaseUrl: string;
  integrations: {
    selarti: false;
    planerka: false;
    telegram: false;
    makeProjection: false;
    intentModel: false;
    payments: false;
  };
  minorOnboarding: false;
  rawConversationLogging: false;
  displayTimezone: string;
};

export function loadEnv(source: NodeJS.ProcessEnv): RuntimeConfig {
  const value = schema.parse(source);

  if (value.RAW_CONVERSATION_LOGGING === "true") {
    throw new Error("Raw conversation logging is prohibited");
  }

  return {
    databaseUrl: value.DATABASE_URL,
    integrations: {
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    },
    minorOnboarding: false,
    rawConversationLogging: false,
    displayTimezone: value.DISPLAY_TIMEZONE,
  };
}
