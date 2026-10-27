import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createLogger } from "@ii-tonya/observability";
import { createWindowedRateLimiter } from "./rate-limit.js";
import { buildApp } from "./app.js";
import {
  closeServer,
  composeServer,
  createDefaultLifecycle,
  listenServer,
  type ServerLifecycle,
} from "./server.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalExpertKeys = process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
const originalClientSessionEnabled = process.env.CLIENT_SESSION_ENABLED;
const originalClientCatalogEnabled = process.env.CLIENT_CATALOG_ENABLED;
afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalExpertKeys === undefined)
    delete process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
  else process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON = originalExpertKeys;
  if (originalClientSessionEnabled === undefined)
    delete process.env.CLIENT_SESSION_ENABLED;
  else process.env.CLIENT_SESSION_ENABLED = originalClientSessionEnabled;
  if (originalClientCatalogEnabled === undefined)
    delete process.env.CLIENT_CATALOG_ENABLED;
  else process.env.CLIENT_CATALOG_ENABLED = originalClientCatalogEnabled;
});
const disabled = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error("disabled");
    },
  },
);

describe("server composition", () => {
  it("passes the configured booking confirmation buffer to the waitlist repository factory", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    const waitlistRepository = {
      join: vi.fn(),
      leave: vi.fn(),
    };
    const waitlistRepositoryFactory = vi.fn(() => waitlistRepository);
    const confirmationBufferMs = 1_234_567;

    const dependencies = await createDefaultLifecycle({
      waitlistRepositoryFactory,
    }).dependencies(
      {
        databaseUrl: "postgresql://placeholder.invalid/test",
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
        displayTimezone: "Europe/Moscow",
        yookassaRecovery: { enabled: false },
        clientBookingConfirmationBufferMs: confirmationBufferMs,
        features: {
          workerOutboxDelivery: false,
          clientCatalog: false,
          clientWaitlist: true,
          expertReferral: false,
          expertReferralMaturityWorker: false,
          expertResidencyBilling: false,
        },
      },
      fakeDb,
    );

    expect(dependencies.clientWaitlistService).toBeDefined();
    expect(waitlistRepositoryFactory).toHaveBeenCalledWith(
      fakeDb,
      confirmationBufferMs,
    );
  });

  it("requires an operational metric sink whenever deterministic promo is enabled", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    await expect(
      createDefaultLifecycle().dependencies(
        {
          databaseUrl: "postgresql://placeholder.invalid/test",
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
          displayTimezone: "Europe/Moscow",
          yookassaRecovery: { enabled: false },
          clientTelegramBotKey: "bot-client",
          clientTelegramBotToken: `123456:${"a".repeat(35)}`,
          features: {
            workerOutboxDelivery: false,
            clientCatalog: false,
            clientTelegramIngress: true,
            testExpertPromo: true,
            testExpertDeterministicFlow: true,
            testExpertSelarti: false,
            expertReferral: false,
            expertReferralMaturityWorker: false,
            expertResidencyBilling: false,
          },
        },
        fakeDb,
      ),
    ).rejects.toThrow("test_expert_metric_sink_unavailable");
  });

  it("composes the PostgreSQL test-expert boundary for deterministic flow without provider activation", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    const base = (await createDefaultLifecycle({
      testExpertMetricSink: { record: () => undefined },
    }).dependencies(
      {
        databaseUrl: "postgresql://placeholder.invalid/test",
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
        displayTimezone: "Europe/Moscow",
        yookassaRecovery: { enabled: false },
        features: {
          workerOutboxDelivery: false,
          clientCatalog: false,
          testExpertPromo: true,
          testExpertDeterministicFlow: true,
          testExpertSelarti: false,
          expertReferral: false,
          expertReferralMaturityWorker: false,
          expertResidencyBilling: false,
        },
      },
      fakeDb,
    )) as { testExpertPromo?: unknown };
    expect(base.testExpertPromo).toBeDefined();
  });

  it("keeps residual disabled unless reconciliation and worker outbox capabilities are enabled", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    const baseFeatures = {
      workerOutboxDelivery: true,
      clientCatalog: false,
      clientHybridRouting: true,
      selartiCostAdmission: true,
      selartiResponseIngress: true,
      b2TelegramDispatch: true,
      b2SensitiveRetention: true,
      testExpertPromo: true,
      testExpertDeterministicFlow: true,
      testExpertSelarti: true,
      testExpertReconciliation: true,
      expertReferral: false,
      expertReferralMaturityWorker: false,
      expertResidencyBilling: false,
    };
    const compose = async (features: typeof baseFeatures) =>
      (await createDefaultLifecycle({
        testExpertMetricSink: { record: () => undefined },
      }).dependencies(
        {
          databaseUrl: "postgresql://placeholder.invalid/test",
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
          displayTimezone: "Europe/Moscow",
          yookassaRecovery: { enabled: false },
          clientTelegramBotKey: "bot-client",
          features,
        },
        fakeDb,
      )) as { testExpertPromo: { residualEnabled: boolean } };

    expect(
      (await compose({ ...baseFeatures, testExpertReconciliation: false }))
        .testExpertPromo.residualEnabled,
    ).toBe(false);
    expect(
      (await compose({ ...baseFeatures, workerOutboxDelivery: false }))
        .testExpertPromo.residualEnabled,
    ).toBe(false);
    expect((await compose(baseFeatures)).testExpertPromo.residualEnabled).toBe(
      true,
    );
  });
  it("keeps client authority absent by default and composes it only with an injected verifier", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      $client: { end: async () => undefined },
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      features: {
        workerOutboxDelivery: false,
        clientSession: false,
        clientCatalog: false,
        clientTelegramIngress: false,
        clientHybridRouting: false,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
      },
    };

    const disabledDeps = await createDefaultLifecycle().dependencies(
      config,
      fakeDb,
    );
    expect(disabledDeps.clientCatalogService).toBeUndefined();
    expect(disabledDeps.clientSessionService).toBeUndefined();
    expect(disabledDeps.clientSessionRepository).toBeUndefined();
    expect(disabledDeps.clientPrincipal).toBeUndefined();
    expect(disabledDeps.clientGateway).toBeUndefined();
    expect(disabledDeps.selartiResponses).toBeUndefined();
    expect(disabledDeps.selartiResponseSharedSecret).toBeUndefined();
    expect(disabledDeps.clientIngressEnabled).toBe(false);
    expect(disabledDeps.clientHybridRoutingEnabled).toBe(false);

    const enabled = {
      ...config,
      features: {
        ...config.features,
        clientSession: true,
        clientCatalog: true,
      },
    };
    await expect(
      createDefaultLifecycle().dependencies(enabled, fakeDb),
    ).rejects.toThrow("Client session verifier capability is required");

    const injected = await createDefaultLifecycle({
      clientSessionComposition: {
        verifier: { verify: async () => null },
      },
    }).dependencies(enabled, fakeDb);
    expect(injected.clientCatalogService).toBeDefined();
    expect(injected.clientSessionService).toBeDefined();
    expect(injected.clientSessionRepository).toBeDefined();
    expect(injected.clientPrincipal).toBeDefined();
  });
  it("fails closed when B2 response ingress is requested without its secret", async () => {
    const appConfig: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      clientTelegramBotKey: "bot-b2",
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        clientTelegramIngress: false,
        clientHybridRouting: false,
        selartiResponseIngress: true,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
      },
    };
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: async (operation: (value: unknown) => unknown) =>
        operation({ execute: async () => ({ rows: [] }) }),
    } as unknown as DrizzleDb;
    const deps = await createDefaultLifecycle().dependencies(appConfig, fakeDb);
    expect(deps.selartiResponses).toBeDefined();
    expect(deps.selartiResponseSharedSecret).toBeUndefined();
    await expect(buildApp(deps)).rejects.toThrow(
      "Selarti response runtime capability is required",
    );
  });
  it("rejects an invalid client feature combination before migration", async () => {
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    process.env.CLIENT_SESSION_ENABLED = "false";
    process.env.CLIENT_CATALOG_ENABLED = "true";
    const migrate = vi.fn(async () => undefined);
    const lifecycle: ServerLifecycle = {
      preflight: createDefaultLifecycle().preflight,
      migrate,
      dependencies: async () => disabled as never,
      close: async () => undefined,
    };
    await expect(composeServer(lifecycle, {} as DrizzleDb)).rejects.toThrow(
      "Client catalog requires client session authority",
    );
    expect(migrate).not.toHaveBeenCalled();
  });
  it("composes the durable expert AI receipt store only with an injected source capability", async () => {
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      $client: {
        query: async () => ({ rows: [], rowCount: 0 }),
        end: async () => undefined,
      },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
        expertAiIngress: false,
      },
    };
    const absent = await createDefaultLifecycle().dependencies(config, fakeDb);
    expect(absent.expertAiIngress).toBeUndefined();
    expect(absent.expertAiPrincipal).toBeUndefined();
    expect(absent.expertAiRequests).toBeUndefined();

    const lifecycle = createDefaultLifecycle({
      expertAiComposition: {
        ingress: { handle: async () => ({ kind: "disabled" }) },
        principals: { resolve: async () => null },
      },
    });
    const deps = await lifecycle.dependencies(config, fakeDb);
    expect(deps.expertAiIngress).toBeDefined();
    expect(deps.expertAiPrincipal).toBeDefined();
    expect(deps.expertAiRequests).toBeInstanceOf(
      (await import("@ii-tonya/db")).PostgresExpertAiRequestReceiptStore,
    );
    await lifecycle.close(fakeDb);
  });
  it("migrates before dependency readiness and closes app before database/telemetry lifecycle", async () => {
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    const order: string[] = [];
    const lifecycle: ServerLifecycle = {
      preflight() {},
      async migrate() {
        order.push("migrate");
      },
      async dependencies(config) {
        order.push("dependencies");
        expect(order).toEqual(["migrate", "dependencies"]);
        return {
          config,
          conversationService: disabled as never,
          bookingService: disabled as never,
          catalogService: disabled as never,
          privacyService: disabled as never,
          adminService: disabled as never,
          selarti: disabled as never,
          telegramCallbacks: disabled as never,
          readiness: {
            check: async () => ({
              postgres: true,
              migrations: true,
              workerLease: true,
              adapters: true,
            }),
          },
          logger: createLogger(),
          inbox: disabled as never,
          rateLimiter: createWindowedRateLimiter(),
          telegramWebhookSecret: "ephemeral-test-placeholder",
        };
      },
      async close() {
        order.push("lifecycle-close");
      },
    };
    const app = await composeServer(lifecycle, {} as DrizzleDb);
    app.addHook("onClose", () => {
      order.push("app-close");
    });
    expect(
      (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    ).toBe(200);
    await closeServer(app, lifecycle, {} as DrizzleDb);
    expect(order).toEqual([
      "migrate",
      "dependencies",
      "app-close",
      "lifecycle-close",
    ]);
  });

  it("constructs the runnable default with PostgreSQL inbox and disabled providers without network calls", async () => {
    const lifecycle = createDefaultLifecycle();
    const fakeDb = {
      execute: async () => ({ rows: [{ present: true, fresh: true }] }),
      $client: { end: async () => undefined },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
      },
    };
    const dependencies = await lifecycle.dependencies(config, fakeDb);
    expect(dependencies.operatorCases).toBeDefined();
    const app = await (await import("./app.js")).buildApp(dependencies);
    expect(
      (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/selarti",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/expert/assistant/messages",
          payload: { text: "Баланс", locale: "ru-RU" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/operator-cases?limit=10",
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
    await lifecycle.close(fakeDb);
  });

  it.each([
    {
      financialViewsEnabled: false,
      checkoutEnabled: false,
      expectedKind: "disabled",
    },
    {
      financialViewsEnabled: true,
      checkoutEnabled: true,
      expectedKind: "processed",
    },
  ] as const)(
    "derives financial and checkout exposure from RuntimeConfig: $financialViewsEnabled/$checkoutEnabled",
    async ({ financialViewsEnabled, checkoutEnabled, expectedKind }) => {
      const referralSummary = vi.fn(async () => ({
        availableMinor: "100000",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: null,
      }));
      const sendReferralSummary = vi.fn(async () => ({
        kind: "applied" as const,
        providerOperationId: "1",
      }));
      const applied = async () => ({
        kind: "applied" as const,
        providerOperationId: "2",
      });
      const checkoutProcess = vi.fn(async () => ({
        kind: "ready" as const,
        tokenHash: "b".repeat(64),
        checkoutUrl: "https://pay.example/checkout",
        replay: false,
      }));
      const lifecycle = createDefaultLifecycle({
        expertTelegramComposition: {
          resolvePrincipal: async (telegramUserId) => ({
            userId: "00000000-0000-4000-8000-000000000100",
            expertId: "00000000-0000-4000-8000-000000000101",
            telegramUserId,
            timezone: "Europe/Moscow",
          }),
          authenticateClientView: async () => null,
          queries: {
            schedule: async () => ({
              timezone: "Europe/Moscow",
              appointments: [],
            }),
            clientChoices: async () => [],
            stats: async () => ({
              upcoming: 0,
              completed: 0,
              cancelled: 0,
              noShow: 0,
            }),
            clientView: async () => {
              throw new Error("not used");
            },
          },
          referral: {
            summary: referralSummary,
            redeemCode: async () => ({ kind: "disabled" as const }),
          },
          residency: {
            listActiveTariffs: async () => ({ kind: "disabled" as const }),
            quote: async () => ({ kind: "disabled" as const }),
          },
          checkout: {
            issue: async () => "xr1.safe",
            process: checkoutProcess,
          },
          views: {
            sendReferralSummary,
            sendReferralRedeemed: applied,
            sendResidencyQuote: applied,
            sendResidencyTariffs: applied,
            sendResidencyCheckoutLink: applied,
            sendQuerySchedule: applied,
            sendClientChoices: applied,
            sendClientView: applied,
            sendStats: applied,
            sendUnsupported: applied,
            answerCallbackQuery: applied,
          },
        },
      });
      const fakeDb = {
        execute: async () => ({ rows: [{ present: true, fresh: true }] }),
        $client: { end: async () => undefined },
      } as unknown as DrizzleDb;
      const config: RuntimeConfig = {
        databaseUrl: "postgresql://placeholder.invalid/test",
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
        displayTimezone: "Europe/Moscow",
        yookassaRecovery: { enabled: false },
        features: {
          workerOutboxDelivery: false,
          clientCatalog: false,
          expertReferral: false,
          expertReferralMaturityWorker: false,
          expertResidencyBilling: false,
          expertTelegramFinancialViews: financialViewsEnabled,
          expertTelegramCheckout: checkoutEnabled,
        },
      };

      const dependencies = await lifecycle.dependencies(config, fakeDb);
      const principal =
        await dependencies.expertTelegramQueries!.resolvePrincipal("123456789");
      await expect(
        dependencies.expertTelegramQueries!.processCommand({
          text: "/referral",
          chatType: "private",
          principal: principal!,
          idempotencyKey: "telegram:1:command",
          correlationId: "corr-1",
        }),
      ).resolves.toMatchObject({ kind: expectedKind });
      expect(referralSummary).toHaveBeenCalledTimes(
        financialViewsEnabled ? 1 : 0,
      );
      expect(sendReferralSummary).toHaveBeenCalledTimes(
        financialViewsEnabled ? 1 : 0,
      );
      const checkoutInput = {
        data: "xr1.safe",
        principal: principal!,
      };
      if (checkoutEnabled) {
        await expect(
          dependencies.expertTelegramQueries!.processResidencyCheckout(
            checkoutInput,
          ),
        ).resolves.toMatchObject({ kind: "ready" });
      } else {
        await expect(
          dependencies.expertTelegramQueries!.processResidencyCheckout(
            checkoutInput,
          ),
        ).rejects.toThrow("Expert Telegram checkout is disabled");
      }
      expect(checkoutProcess).toHaveBeenCalledTimes(checkoutEnabled ? 1 : 0);
      await lifecycle.close(fakeDb);
    },
  );

  it("keeps enabled startup fail-closed when composition dependencies are absent", async () => {
    const lifecycle = createDefaultLifecycle();
    const fakeDb = {
      execute: async () => ({ rows: [] }),
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
        expertTelegramFinancialViews: true,
      },
    };
    await expect(
      (await import("./app.js")).buildApp(
        await lifecycle.dependencies(config, fakeDb),
      ),
    ).rejects.toThrow("Expert Telegram query capability is required");
  });

  it("fails before app composition when an enabled referral key version is unavailable", async () => {
    delete process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
    const lifecycle = createDefaultLifecycle();
    const fakeDb = {
      execute: async () => ({ rows: [{ keyVersion: 2 }] }),
      $client: { end: async () => undefined },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      expertSession: {
        botToken: `123456:${"a".repeat(35)}`,
        botKey: "synthetic-expert-bot",
        origin: "https://expert.example",
        botUsername: "synthetic_expert_bot",
        widgetEnabled: false,
      },
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        expertReferral: true,
        expertSession: true,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
      },
      expertReferralKey: {
        currentVersion: "v1",
        reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      },
    };
    await expect(lifecycle.dependencies(config, fakeDb)).rejects.toThrow(
      "expert_referral_key_unavailable",
    );
  });

  it("passes the startup-validated keyring while public expert routes stay disabled", async () => {
    const keyring = {
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => new Uint8Array(32),
    };
    const resolver = { resolve: () => keyring };
    const lifecycle = createDefaultLifecycle({
      expertCodeSecretResolver: resolver,
    });
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      transaction: vi.fn(),
      $client: { end: async () => undefined },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
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
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      expertSession: {
        botToken: `123456:${"a".repeat(35)}`,
        botKey: "synthetic-expert-bot",
        origin: "https://expert.example",
        botUsername: "synthetic_expert_bot",
        widgetEnabled: false,
      },
      features: {
        workerOutboxDelivery: false,
        clientCatalog: false,
        expertReferral: true,
        expertSession: true,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
      },
      expertReferralKey: {
        currentVersion: "v1",
        reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      },
    };
    const dependencies = await lifecycle.dependencies(config, fakeDb);
    expect(dependencies.expertCodeKeyring).toBe(keyring);
    expect(dependencies.expertReferralAdminService).toBeDefined();
    expect(dependencies.expertApi).toBeDefined();
    const app = await (
      await import("./app.js")
    ).buildApp({
      ...dependencies,
      config: {
        ...dependencies.config,
        features: {
          workerOutboxDelivery: false,
          clientCatalog: false,
          expertReferral: false,
          expertReferralMaturityWorker: false,
          expertResidencyBilling: false,
        },
      },
    });
    expect(
      (app as unknown as { expertCodeKeyring: unknown }).expertCodeKeyring,
    ).toBe(keyring);
    expect(
      (await app.inject({ url: "/v1/expert/referrals/summary" })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: "/v1/expert/residency/tariffs" })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("closes Fastify then telemetry/database exactly once when listen fails", async () => {
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    const order: string[] = [];
    const lifecycle: ServerLifecycle = {
      preflight() {},
      async migrate() {},
      async dependencies(config) {
        return {
          config,
          conversationService: disabled as never,
          bookingService: disabled as never,
          catalogService: disabled as never,
          privacyService: disabled as never,
          adminService: disabled as never,
          selarti: disabled as never,
          telegramCallbacks: disabled as never,
          readiness: {
            check: async () => ({
              postgres: true,
              migrations: true,
              workerLease: true,
              adapters: true,
            }),
          },
          logger: createLogger(),
          inbox: disabled as never,
          rateLimiter: createWindowedRateLimiter(),
          telegramWebhookSecret: "ephemeral-test-placeholder",
        };
      },
      async close() {
        order.push("lifecycle-close");
      },
    };
    const db = {} as DrizzleDb;
    const app = await composeServer(lifecycle, db);
    app.addHook("onClose", () => {
      order.push("app-close");
    });
    await expect(
      listenServer(
        app,
        lifecycle,
        db,
        { host: "127.0.0.1", port: 1 },
        async () => {
          throw new Error("EADDRINUSE");
        },
      ),
    ).rejects.toThrow("EADDRINUSE");
    expect(order).toEqual(["app-close", "lifecycle-close"]);
  });
});

it("rebinds ordinary AI ingress to actual owned offer reads when card offers are enabled", async () => {
  const { loadEnv } = await import("@ii-tonya/config");
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_CARD_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: "123456",
    EXPERT_CARD_WORK_BOT_KEY: "expert-work",
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_work_secret_123456789012",
  });
  config.features.expertAiIngress = true;
  const fakeDb = {
    execute: async () => ({ rows: [] }),
    $client: {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => undefined,
    },
  } as unknown as DrizzleDb;
  const bound = { handle: vi.fn(async () => ({ kind: "disabled" as const })) };
  const withPersonalOffers = vi.fn(() => bound);
  const deps = await createDefaultLifecycle({
    expertAiComposition: {
      ingress: {
        handle: vi.fn(async () => ({ kind: "disabled" as const })),
        withPersonalOffers,
      },
      principals: { resolve: async () => null },
    },
  }).dependencies(config, fakeDb);
  expect(withPersonalOffers).toHaveBeenCalledOnce();
  expect(withPersonalOffers).toHaveBeenCalledWith(
    expect.objectContaining({ readOwned: expect.any(Function) }),
  );
  expect(deps.expertAiIngress).toBe(bound);
  await expect(
    createDefaultLifecycle({
      expertAiComposition: {
        ingress: { handle: vi.fn(async () => ({ kind: "disabled" as const })) },
        principals: { resolve: async () => null },
      },
    }).dependencies(config, fakeDb),
  ).rejects.toThrow("expert_ai_personal_offer_capability_required");
});
