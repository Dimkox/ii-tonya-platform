import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().startsWith("postgres"),
  SELARTI_ENABLED: z.literal("false").default("false"),
  PLANERKA_ENABLED: z.literal("false").default("false"),
  TELEGRAM_ENABLED: z.literal("false").default("false"),
  MAKE_PROJECTION_ENABLED: z.literal("false").default("false"),
  INTENT_MODEL_ENABLED: z.literal("false").default("false"),
  PAYMENTS_ENABLED: z.literal("false").default("false"),
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
