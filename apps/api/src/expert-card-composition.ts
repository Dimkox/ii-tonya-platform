import {
  createPrivateObjectStore,
  createTelegramDocumentReader,
  createIsolatedDocumentParser,
  createResidentGeocoder,
} from "@ii-tonya/integrations";
import { createBookingCallbackAck } from "./booking-callback-ack.js";
import type { ExpertCardLegacyReplayRead } from "./expert-card-telegram-ingress.js";
import {
  createExpertCardService,
  renderPersonalOffer,
  createExpertCardAdminService,
  type ExpertCardService,
  type ExpertCardAdminService,
  type ExpertCardMainCheckout,
} from "@ii-tonya/application";
import { assertExpertCardConfig, type RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresExpertCardRepository,
  PostgresExpertPersonalOfferRepository,
  PostgresExpertOnboardingMainPaymentRepository,
  type DrizzleDb,
  sql,
} from "@ii-tonya/db";
export interface ExpertCardCapability {
  answerTagCallback?: (input: {
    botId: string;
    callbackQueryId: string;
    signal: AbortSignal;
  }) => Promise<void>;
  personalOfferReads?: Pick<PostgresExpertPersonalOfferRepository, "readOwned">;
  legacyReplay: ExpertCardLegacyReplayRead;
  mainCheckoutEnabled: boolean;
  mainCheckout?: ExpertCardMainCheckout;
  workBotId: string;
  workBotKey: string;
  workBotUsername: string;
  webhookSecret: string;
  paymentMode: "test" | "live";
  service: ExpertCardService;
  admin: ExpertCardAdminService;
}
export type ExpertCardCompositionOptions = {
  tagCallbackFetch?: typeof fetch;
  documentImport?: Parameters<
    typeof createExpertCardService
  >[0]["documentImport"];
  mainCheckout?: ExpertCardMainCheckout;
  geocode?: ConstructorParameters<
    typeof PostgresExpertCardRepository
  >[1]["geocode"];
  photoCustody?: ConstructorParameters<
    typeof PostgresExpertCardRepository
  >[1]["photoCustody"];
  materialTransport?: ConstructorParameters<
    typeof PostgresExpertCardRepository
  >[1]["materialTransport"];
};
export function assertExpertCardCapability(
  config: RuntimeConfig,
  capability: ExpertCardCapability | undefined,
): void {
  assertExpertCardConfig(config);
  if (config.features.expertCard !== true) return;
  const settings = config.expertCard!;
  if (
    !capability ||
    (config.features.expertDraftTags === true &&
      typeof capability.answerTagCallback !== "function") ||
    capability.mainCheckoutEnabled !== settings.mainCheckoutEnabled ||
    typeof capability.legacyReplay?.read !== "function" ||
    (settings.mainCheckoutEnabled &&
      (capability.mainCheckout?.strictFirstSendCancellation !== true ||
        typeof capability.mainCheckout.createOrRecover !== "function")) ||
    capability.workBotId !== settings.workBotId ||
    capability.workBotKey !== settings.workBotKey ||
    capability.workBotUsername !== settings.workBotUsername ||
    capability.webhookSecret !== settings.webhookSecret ||
    capability.paymentMode !== settings.paymentMode ||
    typeof capability.service?.handleWork !== "function" ||
    typeof capability.service.handlePromoHandoff !== "function" ||
    typeof capability.admin?.list !== "function" ||
    typeof capability.admin.detail !== "function" ||
    typeof capability.admin.edit !== "function" ||
    typeof capability.admin.review !== "function" ||
    typeof capability.admin.confirmPromo !== "function"
  )
    throw new Error("expert_card_capability_required");
}
export function createExpertCardComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  options: ExpertCardCompositionOptions = {},
): ExpertCardCapability | undefined {
  assertExpertCardConfig(config);
  if (config.features.expertCard !== true) return undefined;
  const settings = config.expertCard!;
  assertExpertCardCheckout(config, options);
  const store =
    config.features.residentPrivateJobs && config.privateVerification
      ? createPrivateObjectStore(config.privateVerification)
      : undefined;
  const reader =
    store && settings.workBotToken
      ? createTelegramDocumentReader({
          botId: settings.workBotId,
          token: settings.workBotToken,
        })
      : undefined;
  const photoCustody =
    options.photoCustody ??
    (store && reader
      ? {
          read: async (input: Parameters<typeof reader.read>[0]) => {
            const r = await reader.read(input);
            return r.kind === "read" ? r.bytes : null;
          },
          put: async (input: Parameters<typeof store.put>[0]) =>
            (await store.put(input)).kind === "verified",
          presign: store.presign.bind(store),
        }
      : undefined);
  const repository = new PostgresExpertCardRepository(db, {
    richOnboarding: true,
    ...(photoCustody ? { photoCustody } : {}),
    ...(options.geocode
      ? { geocode: options.geocode }
      : config.residentGeocode
        ? {
            geocode: createResidentGeocoder({
              ...config.residentGeocode,
              enabled: true,
            }).locate,
          }
        : {}),
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
    workBotId: settings.workBotId,
    workBotKey: settings.workBotKey,
    ...(options.materialTransport
      ? { materialTransport: options.materialTransport }
      : {}),
  });
  const parser = config.privateVerification?.parserSocket
    ? createIsolatedDocumentParser({
        socketPath: config.privateVerification.parserSocket,
        ocr: config.privateVerification.ocr,
      })
    : undefined;
  const documentImport: ExpertCardCompositionOptions["documentImport"] =
    options.documentImport ??
    (reader && parser
      ? {
          read: async (input) =>
            repository.readOwnedDocument(input, async () => {
              if (!input.size || !input.mimeType) return null;
              const type =
                input.mimeType === "application/pdf"
                  ? "pdf"
                  : input.mimeType ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ? "docx"
                    : null;
              if (!type) return null;
              const r = await reader.read({
                ...input,
                fileId: input.reference.slice(14),
                size: input.size,
                mimeType: input.mimeType,
              });
              return r.kind === "read" ? { bytes: r.bytes, type } : null;
            }),
          parser: {
            parse: async (input) => {
              const r = await parser.parse(input);
              return r && r.coverage !== "partial"
                ? { source: input.type, content: r.content }
                : null;
            },
          },
        }
      : undefined);
  const financial = new PostgresExpertOnboardingMainPaymentRepository(db, {
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
    providerMode: settings.paymentMode,
  });
  const acknowledge =
    settings.draftTagsEnabled === true
      ? createBookingCallbackAck(
          settings.workBotToken!,
          options.tagCallbackFetch,
        )
      : undefined;
  return {
    ...(acknowledge
      ? {
          answerTagCallback: async (input: {
            botId: string;
            callbackQueryId: string;
            signal: AbortSignal;
          }) => {
            if (input.botId !== settings.workBotId)
              throw new Error("card_callback_scope_invalid");
            await acknowledge(input);
          },
        }
      : {}),
    personalOfferReads: new PostgresExpertPersonalOfferRepository(db, {
      workBotId: settings.workBotId,
      workBotKey: settings.workBotKey,
      ...(config.expertApplicant
        ? {
            promoBotId: config.expertApplicant.botId,
            promoBotKey: config.expertApplicant.botKey,
            promoConsentPolicyVersion:
              config.expertApplicant.messagingConsentPolicyVersion,
          }
        : {}),
      messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
    }),
    workBotId: settings.workBotId,
    workBotKey: settings.workBotKey,
    workBotUsername: settings.workBotUsername,
    webhookSecret: settings.webhookSecret,
    paymentMode: settings.paymentMode,
    mainCheckoutEnabled: settings.mainCheckoutEnabled,
    ...(settings.mainCheckoutEnabled && options.mainCheckout
      ? { mainCheckout: options.mainCheckout }
      : {}),
    legacyReplay: createExpertCardLegacyReplayRead(db, settings.workBotId),
    service: createExpertCardService({
      enabled: true,
      draftTagsEnabled:
        config.features.expertDraftTags === true &&
        settings.draftTagsEnabled === true,
      ...(documentImport ? { documentImport } : {}),
      paymentMode: settings.paymentMode,
      ...(settings.mainCheckoutEnabled && options.mainCheckout
        ? { mainCheckout: options.mainCheckout }
        : {}),
      workBotId: settings.workBotId,
      workBotKey: settings.workBotKey,
      workBotUsername: settings.workBotUsername,
      ...(config.expertApplicant
        ? {
            promoScope: {
              botId: config.expertApplicant.botId,
              botKey: config.expertApplicant.botKey,
            },
          }
        : {}),
      personalOffers: {
        async read(scope) {
          const offer = await new PostgresExpertPersonalOfferRepository(db, {
            workBotId: settings.workBotId,
            workBotKey: settings.workBotKey,
            ...(config.expertApplicant
              ? {
                  promoBotId: config.expertApplicant.botId,
                  promoBotKey: config.expertApplicant.botKey,
                  promoConsentPolicyVersion:
                    config.expertApplicant.messagingConsentPolicyVersion,
                }
              : {}),
            messagingConsentPolicyVersion:
              settings.messagingConsentPolicyVersion,
          }).read(scope);
          return offer ? { text: renderPersonalOffer(offer) } : null;
        },
      },
      repository,
      financial,
    }),
    admin: createExpertCardAdminService({ enabled: true, repository }),
  };
}

export function assertExpertCardCheckout(
  config: RuntimeConfig,
  options: ExpertCardCompositionOptions = {},
): void {
  assertExpertCardConfig(config);
  if (
    config.features.expertCard !== true ||
    !config.expertCard?.mainCheckoutEnabled
  )
    return;
  if (
    options.mainCheckout?.strictFirstSendCancellation !== true ||
    typeof options.mainCheckout.createOrRecover !== "function"
  )
    throw new Error("expert_card_checkout_capability_required");
}

export function createExpertCardLegacyReplayRead(
  db: DrizzleDb,
  workBotId: string,
): ExpertCardLegacyReplayRead {
  return {
    async read(input) {
      if (
        input.botId !== workBotId ||
        !/^(0|[1-9][0-9]{0,15})$/u.test(input.updateId) ||
        !Number.isSafeInteger(Number(input.updateId))
      )
        throw new Error("expert_card_legacy_replay_invalid");
      const row = (
        await db.execute<{ status: string }>(
          sql`select status from webhook_inbox where provider='telegram' and external_event_id=${input.updateId} limit 1`,
        )
      ).rows[0];
      return !row
        ? "absent"
        : row.status === "complete"
          ? "complete"
          : "pending";
    },
  };
}
