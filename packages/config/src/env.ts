import { z } from "zod";

const isPostgresUrl = (
  value: string,
  allowInsecureLocalDatabase: boolean,
): boolean => {
  try {
    const url = new URL(value);
    const hasPostgresProtocol =
      url.protocol === "postgres:" || url.protocol === "postgresql:";
    if (
      !hasPostgresProtocol ||
      url.hostname.length === 0 ||
      url.pathname.length <= 1
    ) {
      return false;
    }

    const sslModes = url.searchParams.getAll("sslmode");
    if (sslModes.length > 1) {
      return false;
    }

    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
    if (
      allowInsecureLocalDatabase &&
      localHosts.has(url.hostname.toLowerCase())
    ) {
      return true;
    }

    return (
      sslModes.length === 1 &&
      ["require", "verify-ca", "verify-full"].includes(sslModes[0] ?? "")
    );
  } catch {
    return false;
  }
};

const schema = z
  .object({
    DATABASE_URL: z.string(),
    ALLOW_INSECURE_LOCAL_DATABASE: z.enum(["true", "false"]).default("false"),
    SELARTI_ENABLED: z.literal("false").default("false"),
    SELARTI_OUTBOUND_BILLING_MODE: z.literal("disabled").default("disabled"),
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
    EXPERT_REFERRAL_ENABLED: z.enum(["true", "false"]).default("false"),
    EXPERT_RESIDENCY_BILLING_ENABLED: z
      .enum(["true", "false"])
      .default("false"),
    EXPERT_REFERRAL_HMAC_KEY_VERSION: z
      .string()
      .regex(/^v[1-9]\d*$/u)
      .optional(),
    EXPERT_REFERRAL_HMAC_KEY_REF: z
      .literal("env://EXPERT_REFERRAL_HMAC_KEYS_JSON")
      .optional(),
    RAW_CONVERSATION_LOGGING: z.enum(["true", "false"]).default("false"),
    DISPLAY_TIMEZONE: z.string().default("Europe/Moscow"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !isPostgresUrl(
        value.DATABASE_URL,
        value.ALLOW_INSECURE_LOCAL_DATABASE === "true",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message:
          "DATABASE_URL must be a hierarchical Postgres URL with an unambiguous TLS mode unless explicit local evidence mode is enabled",
      });
    }
    if (value.EXPERT_REFERRAL_ENABLED === "true") {
      if (value.EXPERT_REFERRAL_HMAC_KEY_VERSION === undefined) {
        context.addIssue({
          code: "custom",
          path: ["EXPERT_REFERRAL_HMAC_KEY_VERSION"],
          message: "expert_referral_key_version_required",
        });
      }
      if (value.EXPERT_REFERRAL_HMAC_KEY_REF === undefined) {
        context.addIssue({
          code: "custom",
          path: ["EXPERT_REFERRAL_HMAC_KEY_REF"],
          message: "expert_referral_key_reference_required",
        });
      }
    }
  });

const ownedConfigKeys = [
  "DATABASE_URL",
  "ALLOW_INSECURE_LOCAL_DATABASE",
  "SELARTI_ENABLED",
  "SELARTI_OUTBOUND_BILLING_MODE",
  "PLANERKA_ENABLED",
  "TELEGRAM_ENABLED",
  "LLM_ENABLED",
  "MAKE_PROJECTION_ENABLED",
  "GOOGLE_SHEETS_PROJECTION_ENABLED",
  "INTENT_MODEL_ENABLED",
  "PAYMENTS_ENABLED",
  "PAYMENT_PROVIDER",
  "LLM_PROVIDER",
  "MINOR_ONBOARDING_ENABLED",
  "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
  "EXPERT_REFERRAL_HMAC_KEY_VERSION",
  "EXPERT_REFERRAL_HMAC_KEY_REF",
  "RAW_CONVERSATION_LOGGING",
  "DISPLAY_TIMEZONE",
] as const;

const allowedExpertEnvironmentKeys = new Set([
  "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
  "EXPERT_REFERRAL_HMAC_KEY_VERSION",
  "EXPERT_REFERRAL_HMAC_KEY_REF",
  "EXPERT_REFERRAL_HMAC_KEYS_JSON",
]);

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
  selartiOutboundBillingMode: "disabled";
  displayTimezone: string;
  features: {
    expertReferral: boolean;
    expertResidencyBilling: boolean;
  };
  expertReferralKeys: {
    currentVersion: string;
    reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON";
  } | null;
};

export function loadEnv(source: NodeJS.ProcessEnv): RuntimeConfig {
  for (const key of Object.keys(source)) {
    if (
      /^EXPERT_(?:REFERRAL|RESIDENCY)_/u.test(key) &&
      !allowedExpertEnvironmentKeys.has(key)
    ) {
      throw new Error(`unknown_expert_commercial_flag:${key}`);
    }
  }
  const selected: Record<string, string | undefined> = {};
  for (const key of ownedConfigKeys) selected[key] = source[key];
  const value = schema.parse(selected);

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
    selartiOutboundBillingMode: "disabled",
    displayTimezone: value.DISPLAY_TIMEZONE,
    features: {
      expertReferral: value.EXPERT_REFERRAL_ENABLED === "true",
      expertResidencyBilling: value.EXPERT_RESIDENCY_BILLING_ENABLED === "true",
    },
    expertReferralKeys:
      value.EXPERT_REFERRAL_ENABLED === "true"
        ? {
            currentVersion: value.EXPERT_REFERRAL_HMAC_KEY_VERSION!,
            reference: value.EXPERT_REFERRAL_HMAC_KEY_REF!,
          }
        : null,
  };
}
