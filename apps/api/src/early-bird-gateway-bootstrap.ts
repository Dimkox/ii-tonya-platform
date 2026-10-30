import { createEarlyBirdDiscoveryPool } from "./early-bird-discovery-pool.js";
import { createPublicExpertApiRuntime } from "./public-expert-payment-runtime.js";
import {
  publicExpertConnectionNames,
  type PublicExpertPaymentRuntime,
} from "@ii-tonya/db";
import type { EarlyBirdBoundReconciliation } from "./early-bird-bound-reconciliation.js";
import { createExpertEarlyBirdWebhookRuntime } from "./expert-early-bird-webhook-runtime.js";
import { createEarlyBirdDeferredRuntime } from "./expert-early-bird-deferred-runtime.js";
import { PostgresFinalCallEngagement } from "@ii-tonya/db";
import type { EarlyBirdStandardRuntimeConfiguration } from "./expert-early-bird-standard-runtime-composition.js";
import {
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  constants,
} from "node:fs";
import { isAbsolute } from "node:path";
import { createDb, closeDb, type DrizzleDb } from "@ii-tonya/db";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { EarlyBirdOwnerRuntimeConfiguration } from "./expert-early-bird-runtime-composition.js";

type Dictionary = Record<string, unknown>;
const fail = (): never => {
  throw new Error("early_bird_gateway_bootstrap_configuration_invalid");
};
function object(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Dictionary {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const record = value as Dictionary;
  if (
    Object.keys(record).some(
      (key) => !keys.includes(key) && !optional.includes(key),
    ) ||
    keys.some((key) => !(key in record))
  )
    return fail();
  return record;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return fail();
  return value;
}
function path(value: unknown): string {
  const p = text(value, /^\/[A-Za-z0-9_./-]{1,2047}$/u);
  if (!isAbsolute(p) || p.split("/").some((v) => v === "." || v === ".."))
    return fail();
  return p;
}
/** No symlink, hardlink, broad permissions, foreign owner or unbounded file. */
function protectedText(filename: string, limit = 65536): string {
  let fd: number | undefined;
  try {
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size < 1 ||
      stat.size > limit ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      return fail();
    return readFileSync(fd, "utf8").trim();
  } catch {
    return fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function key(filename: unknown): Buffer {
  const raw = protectedText(path(filename), 128);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(raw)) return fail();
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== raw) return fail();
  return bytes;
}
function keyMap(value: unknown, pattern: RegExp): Map<string, Buffer> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 8) return fail();
  return new Map(
    entries.map(([name, file]) => [text(name, pattern), key(file)]),
  );
}
function database(
  value: unknown,
  primaryUrl: string,
): { url: string; login: string } {
  const item = object(value, ["urlFile", "login"]);
  const login = text(item.login, /^[a-z][a-z0-9_]{0,62}$/u);
  const raw = protectedText(path(item.urlFile), 4096);
  try {
    const url = new URL(raw),
      primary = new URL(primaryUrl);
    const local = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(
      url.hostname.toLowerCase(),
    );
    const ssl = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== login ||
      login === decodeURIComponent(primary.username) ||
      !url.password ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash ||
      url.hostname.toLowerCase() !== primary.hostname.toLowerCase() ||
      (url.port || "5432") !== (primary.port || "5432") ||
      url.pathname !== primary.pathname ||
      ssl.length > 1 ||
      (!local &&
        (ssl.length !== 1 ||
          !["require", "verify-ca", "verify-full"].includes(ssl[0] ?? "")))
    )
      return fail();
    return { url: raw, login };
  } catch {
    return fail();
  }
}
/** Loads no merchant credential. Direct API YooKassa secrets are rejected by loadEnv.
 * A reviewed descriptor must point to distinct, least-privilege database logins;
 * their capabilities are checked by the concrete repositories at execution time.
 */
export function loadEarlyBirdGatewayBootstrap(
  config: RuntimeConfig,
  createDatabase: typeof createDb = createDb,
) {
  const settings = config.yookassaGateway;
  if (!settings) return undefined;
  if (!settings.configurationFile) return fail();
  if (
    settings.mode !== "live" ||
    !config.launchPhase ||
    config.features.expertApplicant !== true ||
    config.features.expertSeparatedSales !== true ||
    !config.expertApplicant
  )
    return fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(protectedText(settings.configurationFile));
  } catch {
    return fail();
  }
  const descriptor = object(
    parsed,
    [
      "version",
      "ipc",
      "identityKeyFile",
      "requestKeys",
      "receiptKeys",
      "databases",
    ],
    ["webhookDatabases", "deferredDatabases", "publicDatabases"],
  );
  if (descriptor.version !== 1) return fail();
  const ipc = object(descriptor.ipc, [
    "address",
    "subjectKeyFile",
    "authKeyFile",
    "subjectKeyVersion",
  ]);
  const address = text(ipc.address, /^@[A-Za-z0-9_.-]{1,99}$/u);
  const subjectKeyVersion = text(
    ipc.subjectKeyVersion,
    /^[A-Za-z0-9_-]{1,64}$/u,
  );
  const subjectKey = key(ipc.subjectKeyFile),
    authKey = key(ipc.authKeyFile),
    identityKey = key(descriptor.identityKeyFile);
  if (
    subjectKey.equals(authKey) ||
    subjectKey.equals(identityKey) ||
    authKey.equals(identityKey)
  )
    return fail();
  const requests = object(descriptor.requestKeys, ["activeReference", "files"]),
    receipts = object(descriptor.receiptKeys, ["activeKeyId", "files"]);
  const activeReference = text(
      requests.activeReference,
      /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u,
    ),
    requestKeys = keyMap(
      requests.files,
      /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u,
    );
  const activeKeyId = text(receipts.activeKeyId, /^[A-Za-z0-9_-]{1,64}$/u),
    receiptKeys = keyMap(receipts.files, /^[A-Za-z0-9_-]{1,64}$/u);
  const requestKey = requestKeys.get(activeReference);
  if (!requestKey || !receiptKeys.has(activeKeyId)) return fail();
  const dbs = object(
    descriptor.databases,
    ["sender", "candidateReader", "bindingWriter", "knownBindingReader"],
    ["standardSender"],
  );
  const credentials = Object.fromEntries(
    Object.entries(dbs).map(([name, value]) => [
      name,
      database(value, config.databaseUrl),
    ]),
  );
  const webhookNames = [
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
  const deferredNames = ["prepare", "invoice", "send", "bound"] as const;
  const webhook =
    descriptor.webhookDatabases === undefined
      ? undefined
      : object(descriptor.webhookDatabases, webhookNames);
  const deferred =
    descriptor.deferredDatabases === undefined
      ? undefined
      : object(descriptor.deferredDatabases, deferredNames);
  for (const [prefix, section] of [
    ["webhook", webhook],
    ["deferred", deferred],
  ] as const) {
    for (const [name, value] of Object.entries(section ?? {}))
      credentials[prefix + "/" + name] = database(value, config.databaseUrl);
  }
  if (settings.publicExpertEnabled === true) {
    if (
      !config.expertVerification ||
      config.expertVerification.paymentMode !== settings.mode
    )
      return fail();
    const publicDbs = object(
      descriptor.publicDatabases,
      publicExpertConnectionNames,
    );
    for (const name of publicExpertConnectionNames)
      credentials["public/" + name] = database(
        publicDbs[name],
        config.databaseUrl,
      );
  } else if (descriptor.publicDatabases !== undefined) return fail();
  if (
    new Set(Object.values(credentials).map((value) => value.login)).size !==
    Object.keys(credentials).length
  )
    return fail();
  const gateway = new ExperimentalGatewayIpc({
    address: "\0" + address.slice(1),
    key: subjectKey,
    authKey,
    timeoutMs: 10000,
  });
  const pools: DrizzleDb[] = [];
  let closing: Promise<void> | undefined;
  let reconciliation: EarlyBirdBoundReconciliation | undefined;
  let publicRuntime: PublicExpertPaymentRuntime | undefined;
  const close = () =>
    (closing ??= (async () => {
      let stopFailed = false;
      try {
        const stopped = await Promise.allSettled([
          reconciliation?.stop(),
          publicRuntime?.stop(),
        ]);
        if (stopped.some((result) => result.status === "rejected"))
          stopFailed = true;
      } catch {
        stopFailed = true;
      }
      // Pool.end waits for checked-out clients; it does not terminate an
      // in-flight financial transaction. Every dedicated pool has finite
      // acquisition, statement and lock timeouts.
      const results = await Promise.allSettled(pools.map((db) => closeDb(db)));
      if (stopFailed || results.some((result) => result.status === "rejected"))
        throw new Error("early_bird_gateway_database_close_failed");
    })());
  const connections = new Map<string, { db: DrizzleDb; login: string }>();
  const connection = (name: string) => {
    const prior = connections.get(name);
    if (prior) return prior;
    const credential = credentials[name];
    if (!credential) return fail();
    const db = createDatabase(credential.url, {
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 4000,
      options: "-c statement_timeout=4000 -c lock_timeout=2000",
    });
    pools.push(db);
    const value = { db, login: credential.login };
    connections.set(name, value);
    return value;
  };
  try {
    const runtime: EarlyBirdOwnerRuntimeConfiguration = {
      checkout: {
        policy: config.expertApplicant,
        identityKey,
        requestKey,
        requestKeyReference: activeReference,
        retainedRequestKeys: requestKeys,
        receiptVault: createPayerReceiptVault({
          activeKeyId,
          keys: receiptKeys,
        }),
        returnUrl: settings.returnUrl,
        onboardingFiscal: settings.receipt,
        subscriptionFiscal: settings.receipt,
      },
      gateway,
      gatewaySubjectKeyVersion: subjectKeyVersion,
      sender: connection("sender"),
      candidateReader: connection("candidateReader"),
      bindingWriter: connection("bindingWriter"),
      knownBindingReader: connection("knownBindingReader"),
    };
    const standardRuntime: EarlyBirdStandardRuntimeConfiguration | undefined =
      credentials.standardSender
        ? { ...runtime, sender: connection("standardSender") }
        : undefined;
    return {
      runtime,
      standardRuntime,
      gateway,
      subjectKeyVersion,
      close,
      startReconciliation() {
        reconciliation?.start();
        publicRuntime?.start();
      },
      stopReconciliation() {
        return Promise.all([reconciliation?.stop(), publicRuntime?.stop()]);
      },
      serverOptions(db: DrizzleDb) {
        if (!standardRuntime || !webhook || !deferred || !config.launchPhase)
          return fail();
        const webhookConnections = {
          compositePaymentReader: runtime.knownBindingReader,
          ...Object.fromEntries(
            webhookNames.map((name) => [name, connection("webhook/" + name)]),
          ),
        } as Parameters<
          typeof createExpertEarlyBirdWebhookRuntime
        >[0]["connections"];
        // The ordinary API credential is reused solely for SELECT discovery.
        // Its own max-one pool bounds checkout independently of HTTP traffic.
        const discoveryDb = createEarlyBirdDiscoveryPool(config.databaseUrl);
        pools.push(discoveryDb);
        const { boundReconciliation, ...webhookRuntime } =
          createExpertEarlyBirdWebhookRuntime({
            db,
            discoveryDb,
            gateway,
            connections: webhookConnections,
          });
        reconciliation = boundReconciliation;
        const prepare = connection("deferred/prepare"),
          invoice = connection("deferred/invoice"),
          send = connection("deferred/send"),
          bound = connection("deferred/bound");
        const snapshot = webhookConnections.deferredSnapshotReader,
          binding = webhookConnections.deferredPaymentBinding,
          settlement = webhookConnections.deferredPaymentSettlement;
        const deferredRuntime = createEarlyBirdDeferredRuntime({
          enabled: true,
          db,
          prepareDb: prepare.db,
          invoiceDb: invoice.db,
          sendDb: send.db,
          boundDb: bound.db,
          snapshotDb: snapshot.db,
          bindingDb: binding.db,
          settlementDb: settlement.db,
          logins: {
            prepare: prepare.login,
            invoice: invoice.login,
            send: send.login,
            bound: bound.login,
            snapshot: snapshot.login,
            binding: binding.login,
            settlement: settlement.login,
          },
          policy: config.expertApplicant!,
          gateway,
          client: gateway,
          vault: runtime.checkout.receiptVault,
          identityKey,
          requestKey,
          keyReference: activeReference,
          returnUrl: settings.returnUrl,
          onboardingFiscal: settings.receipt,
          subscriptionFiscal: settings.receipt,
          engagement: new PostgresFinalCallEngagement(db),
          clientStartMs: config.launchPhase.clientStartMs,
        })!;
        const publicApi =
          settings.publicExpertEnabled === true
            ? createPublicExpertApiRuntime(db, {
                connections: Object.fromEntries(
                  publicExpertConnectionNames.map((name) => [
                    name,
                    connection("public/" + name),
                  ]),
                ) as Parameters<
                  typeof createPublicExpertApiRuntime
                >[1]["connections"],
                gateway,
                mode: settings.mode,
                messagingConsentPolicyVersion:
                  config.expertVerification!.messagingConsentPolicyVersion,
                vault: runtime.checkout.receiptVault,
                requestKey,
                requestKeyReference: activeReference,
                retainedRequestKeys: requestKeys,
                returnUrl: settings.returnUrl,
                vatCode: settings.receipt.vatCode,
              })
            : undefined;
        publicRuntime = publicApi?.runtime;
        return {
          ...publicApi?.options,
          // Recovery reads trusted source facts only. This is the ordinary
          // primary connection, not a claimed read-only database principal.
          // Candidate discovery never POSTs; verification and binding retain
          // their dedicated least-privilege credentials.
          earlyBirdRuntime: { ...runtime, recovery: { db } },
          earlyBirdStandardRuntime: { ...standardRuntime, recovery: { db } },
          earlyBirdDeferred: deferredRuntime.authority,
          receiptDisclosureGateway: gateway,
          receiptDisclosureKeyVersion: subjectKeyVersion,
          ...webhookRuntime,
        };
      },
    };
  } catch (error) {
    void close().catch(() => undefined);
    throw error;
  }
}
