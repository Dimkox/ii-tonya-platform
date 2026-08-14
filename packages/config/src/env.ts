import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

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
    PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
    EXPERT_REFERRAL_ENABLED: z.enum(["true", "false"]).default("false"),
    EXPERT_RESIDENCY_BILLING_ENABLED: z
      .enum(["true", "false"])
      .default("false"),
    EXPERT_TELEGRAM_QUERIES_ENABLED: z.enum(["true", "false"]).default("false"),
    EXPERT_REFERRAL_HMAC_KEY_VERSION: z.string().optional(),
    EXPERT_REFERRAL_HMAC_KEY_REF: z.string().optional(),
    PAYMENT_PROVIDER: z.enum(["disabled", "yookassa"]).default("disabled"),
    YOOKASSA_ENABLED: z.enum(["true", "false"]).default("false"),
    YOOKASSA_MODE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["test", "live"]).optional(),
    ),
    YOOKASSA_SHOP_ID: optionalNonEmptyString,
    YOOKASSA_SECRET_KEY: optionalNonEmptyString,
    YOOKASSA_SECRET_REF: optionalNonEmptyString,
    YOOKASSA_RETURN_URL: optionalNonEmptyString,
    YOOKASSA_RECEIPT_VAT_CODE: optionalNonEmptyString,
    YOOKASSA_RECEIPT_PAYMENT_SUBJECT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .enum([
          "commodity",
          "excise",
          "job",
          "payment",
          "property_right",
          "service",
        ])
        .optional(),
    ),
    YOOKASSA_RECEIPT_PAYMENT_MODE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .enum([
          "advance",
          "credit",
          "credit_payment",
          "full_payment",
          "full_prepayment",
          "partial_payment",
          "partial_prepayment",
        ])
        .optional(),
    ),
    LLM_PROVIDER: z.literal("disabled").default("disabled"),
    MINOR_ONBOARDING_ENABLED: z.literal("false").default("false"),
    RAW_CONVERSATION_LOGGING: z.enum(["true", "false"]).default("false"),
    DISPLAY_TIMEZONE: z.string().default("Europe/Moscow"),
  })
  .passthrough()
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
      if (!/^v[1-9]\d*$/u.test(value.EXPERT_REFERRAL_HMAC_KEY_VERSION ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["EXPERT_REFERRAL_HMAC_KEY_VERSION"],
          message: "expert_referral_key_unavailable",
        });
      }
      if (
        value.EXPERT_REFERRAL_HMAC_KEY_REF !==
        "env://EXPERT_REFERRAL_HMAC_KEYS_JSON"
      ) {
        context.addIssue({
          code: "custom",
          path: ["EXPERT_REFERRAL_HMAC_KEY_REF"],
          message: "expert_referral_key_unavailable",
        });
      }
    }
    const activationRequested =
      value.YOOKASSA_ENABLED === "true" ||
      value.PAYMENTS_ENABLED === "true" ||
      value.PAYMENT_PROVIDER === "yookassa";
    if (activationRequested) {
      let returnUrlValid = false;
      try {
        const returnUrl = new URL(value.YOOKASSA_RETURN_URL ?? "");
        returnUrlValid =
          returnUrl.protocol === "https:" &&
          returnUrl.hostname === "ii-tonya.ru";
      } catch {
        returnUrlValid = false;
      }
      const vatCode = Number(value.YOOKASSA_RECEIPT_VAT_CODE);
      if (
        value.YOOKASSA_ENABLED !== "true" ||
        value.PAYMENTS_ENABLED !== "true" ||
        value.PAYMENT_PROVIDER !== "yookassa" ||
        value.YOOKASSA_MODE === undefined ||
        !/^\d{1,32}$/u.test(value.YOOKASSA_SHOP_ID ?? "") ||
        (value.YOOKASSA_SECRET_KEY?.length ?? 0) < 8 ||
        value.YOOKASSA_SECRET_REF !== "env://YOOKASSA_SECRET_KEY" ||
        !returnUrlValid ||
        !Number.isInteger(vatCode) ||
        vatCode < 1 ||
        vatCode > 12 ||
        (value.YOOKASSA_RECEIPT_PAYMENT_SUBJECT?.length ?? 0) < 1 ||
        (value.YOOKASSA_RECEIPT_PAYMENT_MODE?.length ?? 0) < 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["YOOKASSA_ENABLED"],
          message: "yookassa_configuration_incomplete",
        });
      }
    }
  });

export type RuntimeConfig = {
  databaseUrl: string;
  integrations: {
    selarti: false;
    planerka: false;
    telegram: false;
    makeProjection: false;
    intentModel: false;
    payments: boolean;
  };
  minorOnboarding: false;
  rawConversationLogging: false;
  selartiOutboundBillingMode: "disabled";
  displayTimezone: string;
  features: {
    expertReferral: boolean;
    expertResidencyBilling: boolean;
    expertTelegramQueries?: boolean;
    yookassa?: boolean;
  };
  expertReferralKey?: {
    currentVersion: string;
    reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON";
  };
  yookassa?: {
    mode: "test" | "live";
    shopId: string;
    secretReference: "env://YOOKASSA_SECRET_KEY";
    returnUrl: string;
    receipt: {
      vatCode: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
      paymentSubject: string;
      paymentMode: string;
    };
  };
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
      payments: value.PAYMENTS_ENABLED === "true",
    },
    minorOnboarding: false,
    rawConversationLogging: false,
    selartiOutboundBillingMode: "disabled",
    displayTimezone: value.DISPLAY_TIMEZONE,
    features: {
      expertReferral: value.EXPERT_REFERRAL_ENABLED === "true",
      expertResidencyBilling: value.EXPERT_RESIDENCY_BILLING_ENABLED === "true",
      expertTelegramQueries: value.EXPERT_TELEGRAM_QUERIES_ENABLED === "true",
      yookassa: value.YOOKASSA_ENABLED === "true",
    },
    ...(value.EXPERT_REFERRAL_ENABLED === "true"
      ? {
          expertReferralKey: {
            currentVersion: value.EXPERT_REFERRAL_HMAC_KEY_VERSION!,
            reference:
              value.EXPERT_REFERRAL_HMAC_KEY_REF as "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
          },
        }
      : {}),
    ...(value.YOOKASSA_ENABLED === "true"
      ? {
          yookassa: {
            mode: value.YOOKASSA_MODE!,
            shopId: value.YOOKASSA_SHOP_ID!,
            secretReference:
              value.YOOKASSA_SECRET_REF as "env://YOOKASSA_SECRET_KEY",
            returnUrl: value.YOOKASSA_RETURN_URL!,
            receipt: {
              vatCode: Number(value.YOOKASSA_RECEIPT_VAT_CODE) as
                1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12,
              paymentSubject: value.YOOKASSA_RECEIPT_PAYMENT_SUBJECT!,
              paymentMode: value.YOOKASSA_RECEIPT_PAYMENT_MODE!,
            },
          },
        }
      : {}),
  };
}
