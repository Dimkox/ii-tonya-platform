import {
  PostgresYooKassaPaymentPurposeRepository,
  PostgresYooKassaRefundParentBinding,
  PostgresEarlyBirdPaymentSettlementStore,
  PostgresEarlyBirdRefundBindingReader,
  PostgresEarlyBirdRefundBindingStore,
  PostgresEarlyBirdRefundSettlementStore,
} from "@ii-tonya/db";
import {
  PostgresWebhookInboxRepository,
  PostgresYooKassaOperationRepository,
  PostgresExpertResidencyProviderInboxRepository,
  PostgresEarlyBirdVerifiedPaymentReader,
  PostgresDeferredSnapshotReader,
  PostgresDeferredPaymentRouteReader,
  PostgresDeferredVerifiedStore,
  PostgresDeferredRefundReader,
  PostgresDeferredRefundStore,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  ExperimentalGatewayIpc,
  YooKassaPaymentVerifier,
  YooKassaWebhookCapability,
  YooKassaEarlyBirdVerifier,
  YooKassaEarlyBirdWebhookCapability,
  YooKassaEarlyBirdRefundDiscovery,
  YooKassaDeferredVerifier,
  YooKassaDeferredRefundVerifier,
} from "@ii-tonya/integrations";
import { DeferredPaymentWebhookHandler } from "./early-bird-deferred-payment-handler.js";
import { DeferredRefundWebhookHandler } from "./early-bird-deferred-refund-handler.js";
import { createEarlyBirdWebhookRouting } from "./early-bird-webhook-routing.js";
import type { YooKassaWebhookDependencies } from "./routes/yookassa-webhook.js";
import { effectivePeerAddress } from "./yookassa-peer.js";

type Connection = { db: DrizzleDb; login: string };
type Connections = Record<
  | "compositePaymentReader"
  | "compositePaymentSettlement"
  | "compositeRefundReader"
  | "compositeRefundBinding"
  | "compositeRefundSettlement"
  | "deferredPaymentLookup"
  | "deferredSnapshotReader"
  | "deferredPaymentBinding"
  | "deferredPaymentSettlement"
  | "deferredRefundReader"
  | "deferredRefundBinding"
  | "deferredRefundSettlement"
  | "deferredRefundCancel",
  Connection
>;
/** Explicit trusted assembly. Isolated database credentials and authenticated gateway are required. */
export function createExpertEarlyBirdWebhookRuntime(options: {
  db: DrizzleDb;
  gateway: ExperimentalGatewayIpc;
  connections: Connections;
}) {
  const roles = [
    "compositePaymentReader",
    "compositePaymentSettlement",
    "compositeRefundReader",
    "compositeRefundBinding",
    "compositeRefundSettlement",
    "deferredPaymentLookup",
    "deferredSnapshotReader",
    "deferredPaymentBinding",
    "deferredPaymentSettlement",
    "deferredRefundReader",
    "deferredRefundBinding",
    "deferredRefundSettlement",
    "deferredRefundCancel",
  ] as const;
  if (
    !options ||
    !options.db ||
    !(options.gateway instanceof ExperimentalGatewayIpc) ||
    roles.some(
      (key) =>
        !options.connections?.[key]?.db ||
        !/^[a-z][a-z0-9_]{0,62}$/u.test(options.connections[key].login),
    )
  )
    throw new Error("early_bird_webhook_configuration_invalid");
  const c = options.connections,
    gateway = options.gateway;
  const operations = new PostgresYooKassaOperationRepository(options.db);
  const legacyVerifier = new YooKassaPaymentVerifier(gateway, operations);
  const legacy = new YooKassaWebhookCapability(operations, legacyVerifier);
  const settlements = new PostgresExpertResidencyProviderInboxRepository(
    options.db,
    { waveCoverage: true },
  );
  const purpose = new PostgresYooKassaPaymentPurposeRepository(options.db);
  const parent = new PostgresYooKassaRefundParentBinding(options.db);
  const payments = new PostgresEarlyBirdVerifiedPaymentReader(
    c.compositePaymentReader.db,
    c.compositePaymentReader.login,
  );
  const verifier = new YooKassaEarlyBirdVerifier(gateway, payments);
  const paymentStore = new PostgresEarlyBirdPaymentSettlementStore(
    c.compositePaymentSettlement.db,
    verifier,
    c.compositePaymentSettlement.login,
  );
  const paymentHandler = new YooKassaEarlyBirdWebhookCapability(
    {
      findInvoiceByProviderObject: (id) =>
        payments.findInvoiceByProviderObject(id),
      commit: (proof) => paymentStore.commit(proof),
    },
    verifier,
  );
  const refundReader = new PostgresEarlyBirdRefundBindingReader(
    c.compositeRefundReader.db,
    c.compositeRefundReader.login,
  );
  const refundDiscovery = new YooKassaEarlyBirdRefundDiscovery(
    gateway,
    payments,
    { findRefundBinding: (id) => refundReader.findRefundBinding(id) },
    (issuer) => {
      const binder = new PostgresEarlyBirdRefundBindingStore(
        c.compositeRefundBinding.db,
        issuer,
        c.compositeRefundBinding.login,
      );
      const writer = new PostgresEarlyBirdRefundSettlementStore(
        c.compositeRefundSettlement.db,
        issuer,
        c.compositeRefundSettlement.login,
      );
      return {
        bind: (proof) => binder.bind(proof),
        settle: (proof) => writer.commit(proof),
      };
    },
  );
  const deferredPaymentLookup = new PostgresDeferredPaymentRouteReader(
    c.deferredPaymentLookup.db,
    c.deferredPaymentLookup.login,
  );
  const snapshot = new PostgresDeferredSnapshotReader(
    c.deferredSnapshotReader.db,
    c.deferredSnapshotReader.login,
  );
  const deferredVerifier = new YooKassaDeferredVerifier(gateway, snapshot);
  const deferredStore = new PostgresDeferredVerifiedStore(
    c.deferredPaymentBinding.db,
    c.deferredPaymentSettlement.db,
    deferredVerifier,
    c.deferredPaymentBinding.login,
    c.deferredPaymentSettlement.login,
  );
  const deferredPaymentHandler = new DeferredPaymentWebhookHandler(
    deferredPaymentLookup,
    deferredVerifier,
    deferredStore,
  );
  const deferredReader = new PostgresDeferredRefundReader(
    c.deferredRefundReader.db,
    c.deferredRefundReader.login,
  );
  const deferredRefundVerifier = new YooKassaDeferredRefundVerifier(
    gateway,
    deferredReader,
  );
  const deferredRefundStore = new PostgresDeferredRefundStore(
    c.deferredRefundBinding.db,
    c.deferredRefundSettlement.db,
    deferredRefundVerifier,
    c.deferredRefundBinding.login,
    c.deferredRefundSettlement.login,
    c.deferredRefundCancel.db,
    c.deferredRefundCancel.login,
  );
  const deferredRefundHandler = new DeferredRefundWebhookHandler(
    deferredRefundVerifier,
    deferredRefundStore,
  );
  const routing = createEarlyBirdWebhookRouting({
    legacy: (id, event) => purpose.resolvePurpose(id, event),
    findInvoice: (id) => payments.findInvoiceByProviderObject(id),
    getRefund: (id) => gateway.getRefund(id),
    exactLegacyRefund: (id, payment) => parent.matches(id, payment),
    paymentHandler,
    refundDiscovery,
    deferredPaymentLookup,
    deferredPaymentHandler,
    deferredRefund: {
      findByProviderPayment: (id) => deferredReader.findByProviderPayment(id),
      handle: (event) => deferredRefundHandler.handle(event),
    },
  });
  const webhook: Omit<YooKassaWebhookDependencies, "onboarding"> = {
    effectivePeerAddress,
    inbox: new PostgresWebhookInboxRepository(options.db),
    verify: (event) => legacy.verify(event),
    resolveSucceeded: (event) => legacy.resolveSucceeded(event),
    deliver: async (event) => {
      if (event.kind === "settled") await settlements.settle(event);
      else await settlements.reverse(event);
    },
  };
  return { yookassaWebhook: webhook, earlyBirdWebhookRouting: routing };
}
