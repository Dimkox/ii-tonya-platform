import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  PublicExpertGatewayTransport,
  PublicExpertRecovery,
  type ExperimentalGatewayIpc,
  type PayerReceiptVault,
  type YooKassaReplayAssociatedData,
  type YooKassaReplayProtector,
  type YooKassaReplayDecryptor,
  type YooKassaVatCode,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "./client.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PostgresPublicExpertPaymentPosting,
  PublicHeldOnboardingCheckout,
  PublicMainResidencyCheckout,
} from "./repositories/public-expert-payment-gateway.js";
import { PostgresExpertVerificationRepository } from "./repositories/expert-verification-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./repositories/expert-residency-provider-inbox-repository.js";

export const publicExpertConnectionNames = [
  "onboardingSender",
  "mainSender",
  "refundSender",
  "binder",
  "observations",
] as const;
export type PublicExpertRuntimeConfiguration = {
  connections: Record<
    (typeof publicExpertConnectionNames)[number],
    { db: DrizzleDb; login: string }
  >;
  gateway: ExperimentalGatewayIpc;
  mode: "test" | "live";
  messagingConsentPolicyVersion: string;
  vault: PayerReceiptVault;
  requestKey: Buffer;
  requestKeyReference: string;
  retainedRequestKeys: ReadonlyMap<string, Buffer>;
  returnUrl: string;
  vatCode: YooKassaVatCode;
};
/** Receipt envelopes are product/version and exact-operation bound. They are only
 * decrypted for the first prepared send; uncertainty recovery is GET/LIST only. */
function envelope(config: PublicExpertRuntimeConfiguration) {
  const aad = (data: YooKassaReplayAssociatedData) =>
    Buffer.from(
      JSON.stringify([
        "public-expert-request-v1",
        data.operationId,
        data.operationKind,
        data.idempotencyKey,
        data.requestDigest,
        data.bodyVersion,
      ]),
    );
  if (
    config.requestKey.length !== 32 ||
    !config.retainedRequestKeys
      .get(config.requestKeyReference)
      ?.equals(config.requestKey)
  )
    throw Error("public_request_key_invalid");
  const protector: YooKassaReplayProtector = {
    async protect(input) {
      if (input.bodyVersion !== 1 || Buffer.byteLength(input.body) > 131072)
        throw Error("public_envelope_invalid");
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", config.requestKey, iv);
      cipher.setAAD(aad(input.associatedData));
      const bytes = Buffer.concat([
        cipher.update(input.body, "utf8"),
        cipher.final(),
      ]);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
          "base64url",
        ),
        keyReference: config.requestKeyReference,
        bodyVersion: 1,
        expiresAt: new Date(Date.now() + 22 * 3600000).toISOString(),
      };
    },
  };
  const decryptor: YooKassaReplayDecryptor = {
    async decrypt(input) {
      const key = config.retainedRequestKeys.get(input.keyReference),
        raw = Buffer.from(input.encryptedBody, "base64url");
      if (
        !key ||
        key.length !== 32 ||
        raw.length < 29 ||
        raw.length > 131100 ||
        raw.toString("base64url") !== input.encryptedBody
      )
        throw Error("public_envelope_invalid");
      const cipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      cipher.setAAD(aad(input.associatedData));
      cipher.setAuthTag(raw.subarray(12, 28));
      return {
        body: Buffer.concat([
          cipher.update(raw.subarray(28)),
          cipher.final(),
        ]).toString("utf8"),
        bodyVersion: 1,
      };
    },
  };
  return { protector, decryptor };
}
/** Five isolated SQL capabilities. The existing trusted canonical poster keeps
 * financial transactions; no provider call runs within a database transaction. */
export function createPublicExpertPaymentRuntime(
  db: DrizzleDb,
  config: PublicExpertRuntimeConfiguration,
) {
  const roles = publicExpertConnectionNames.map(
    (name) => config.connections[name],
  );
  if (
    roles.some(
      (role) => !role?.db || !/^[a-z][a-z0-9_]{0,62}$/u.test(role.login),
    ) ||
    new Set(roles.map((role) => role.login)).size !== 5 ||
    new Set(roles.map((role) => role.db)).size !== 5 ||
    roles.some((role) => role.db === db)
  )
    throw Error("public_expert_capabilities_required");
  const source = new PostgresPublicExpertPaymentSource({
    onboarding: config.connections.onboardingSender.db,
    main: config.connections.mainSender.db,
    refund: config.connections.refundSender.db,
  });
  const binder = new PostgresPublicExpertPaymentBinder(
      config.connections.binder.db,
    ),
    observations = new PostgresPublicExpertPaymentObservations(
      config.connections.observations.db,
    );
  const posting = new PostgresPublicExpertPaymentPosting(
    observations,
    new PostgresExpertResidencyProviderInboxRepository(db),
    new PostgresExpertVerificationRepository(db, {
      providerMode: config.mode,
      messagingConsentPolicyVersion: config.messagingConsentPolicyVersion,
    }),
  );
  const transport = new PublicExpertGatewayTransport(config.gateway),
    reader = new PublicExpertRecovery({
      binder,
      observations,
      transport,
      now: () => new Date(Date.now()).toISOString(),
    });
  // Background discovery retains at most its ten queued scans independently of
  // interactive callback traffic, so new hints cannot evict its progress.
  const pendingTransport = new PublicExpertGatewayTransport(config.gateway);
  const pendingReader = new PublicExpertRecovery({
    binder,
    observations,
    transport: pendingTransport,
    now: () => new Date(Date.now()).toISOString(),
  });
  let accepting = true,
    cursor: string | null = null,
    refundCursor: string | null = null,
    running: Promise<unknown> | undefined,
    timer: ReturnType<typeof setInterval> | undefined;
  const shutdown = new AbortController(),
    active = new Set<Promise<unknown>>();
  const pending: { id: string; discovered: boolean }[] = [];
  const track = <T>(work: Promise<T>) => {
    active.add(work);
    void work.then(
      () => active.delete(work),
      () => active.delete(work),
    );
    return work;
  };
  async function bounded<T>(
    parent: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ) {
    const deadline = new AbortController(),
      timeout = setTimeout(() => deadline.abort(), 15000);
    const signal = AbortSignal.any([
      shutdown.signal,
      deadline.signal,
      ...(parent ? [parent] : []),
    ]);
    try {
      return await work(signal);
    } finally {
      clearTimeout(timeout);
    }
  }
  function recoverWith(
    selected: PublicExpertRecovery,
    id: string,
    options: { signal?: AbortSignal | undefined } = {},
  ) {
    return track(
      bounded(options.signal, async (signal) => {
        if (!accepting || signal.aborted)
          return { kind: "unavailable" as const };
        const result = await selected.recover(id, { signal });
        if (
          result.kind === "observed" &&
          accepting &&
          !signal.aborted &&
          ["succeeded", "canceled"].includes(result.observation.status)
        )
          await posting.apply(id, result.observationId);
        return result;
      }),
    );
  }
  const recovery = {
    recover(id: string, options: { signal?: AbortSignal | undefined } = {}) {
      return recoverWith(reader, id, options);
    },
  };
  const deps = {
    get enabled() {
      return accepting;
    },
    mode: config.mode,
    signal: shutdown.signal,
    source,
    vault: config.vault,
    ...envelope(config),
    transport: {
      async dispatch(
        ...args: Parameters<PublicExpertGatewayTransport["dispatch"]>
      ) {
        if (!accepting) throw Error("public_runtime_stopped");
        const signal = AbortSignal.any([
          shutdown.signal,
          ...(args[2] ? [args[2]] : []),
        ]);
        return track(transport.dispatch(args[0], args[1], signal));
      },
    },
    recovery,
    returnUrl: config.returnUrl,
    vatCode: config.vatCode,
  };
  const held = new PublicHeldOnboardingCheckout(deps),
    main = new PublicMainResidencyCheckout(deps);
  async function runOnce() {
    if (!accepting || running) return;
    const paymentLane = async (signal: AbortSignal) => {
      if (signal.aborted) return;
      if (!pending.length) {
        const result = await config.connections.binder.db.execute<{
          value: string[];
        }>(
          sql`select early_bird_private.public_payment_pending(10,${cursor}::uuid) value`,
        );
        const ids = result.rows[0]?.value;
        if (
          !Array.isArray(ids) ||
          ids.length > 10 ||
          ids.some((id) => !/^[0-9a-f-]{36}$/iu.test(id))
        )
          throw Error("public_discovery_invalid");
        if (!ids.length) cursor = null;
        pending.push(...ids.map((id) => ({ id, discovered: true })));
      }
      const count = pending.length;
      for (let index = 0; index < count; index++) {
        if (!accepting || signal.aborted) break;
        const item = pending.shift()!;
        if (item.discovered) cursor = item.id;
        let observed = false;
        try {
          observed =
            (await recoverWith(pendingReader, item.id, { signal })).kind ===
            "observed";
        } catch {
          /* preserve durable uncertainty */
        }
        // Resume an interrupted multi-page scan before admitting another batch;
        // an immutable creation window and complete traversal remain mandatory.
        if (!observed && pendingTransport.hasIncompleteScan(item.id)) {
          const retry = { id: item.id, discovered: false };
          // A completed discovery gets its fresh GET on the next turn before
          // its bounded discovery lifetime expires; partial traversals rotate.
          if (pendingTransport.hasPendingVerification(item.id))
            pending.unshift(retry);
          else pending.push(retry);
        }
      }
    };
    const refundLane = async (signal: AbortSignal) => {
      if (!accepting || signal.aborted) return;
      const refunds = await config.connections.refundSender.db.execute<{
        value: { userId: string; operationId: string }[];
      }>(
        sql`select early_bird_private.public_refund_pending(10,${refundCursor}::uuid) value`,
      );
      const commands = refunds.rows[0]?.value;
      if (!Array.isArray(commands) || commands.length > 10)
        throw Error("public_refund_discovery_invalid");
      if (!commands.length) refundCursor = null;
      for (const command of commands) {
        if (!accepting || signal.aborted) break;
        refundCursor = command.operationId;
        try {
          await main.createOrRecoverRefund(command, { signal });
        } catch {
          /* exact authorized command remains pending */
        }
      }
    };
    // Independent deadlines guarantee every lane a turn even under sustained
    // slow backlog. All I/O receives its lane signal; no timeout abandons work.
    const work = track(
      Promise.allSettled([
        bounded(undefined, paymentLane),
        bounded(undefined, (signal) => held.reconcileKnown(10, { signal })),
        bounded(undefined, refundLane),
      ]),
    );
    running = work;
    try {
      await work;
    } finally {
      if (running === work) running = undefined;
    }
  }
  return {
    held,
    main,
    recovery,
    async assertReady() {
      const signatures = {
        onboardingSender: [
          "public_onboarding_source(uuid,uuid)",
          "public_onboarding_invoice(uuid)",
          "public_onboarding_pending(integer,uuid)",
          "public_onboarding_prepare(uuid,uuid,uuid,jsonb)",
          "public_onboarding_admit(uuid,uuid,text)",
        ],
        mainSender: [
          "public_main_source(uuid,uuid)",
          "public_main_prepare(uuid,uuid,uuid,jsonb)",
          "public_main_admit(uuid,uuid,text)",
        ],
        refundSender: [
          "public_refund_source(uuid,uuid)",
          "public_refund_prepare(uuid,uuid,uuid,jsonb)",
          "public_refund_admit(uuid,uuid,text)",
          "public_refund_pending(integer,uuid)",
        ],
        binder: [
          "public_payment_candidate(uuid)",
          "public_payment_bind(uuid,text,jsonb)",
          "public_payment_pending(integer,uuid)",
          "public_payment_hint(text,uuid,boolean)",
        ],
        observations: [
          "public_payment_observe(uuid,text,jsonb)",
          "public_payment_resolve(uuid,uuid)",
          "public_payment_complete(uuid,uuid)",
        ],
      };
      for (const name of publicExpertConnectionNames) {
        const role = config.connections[name];
        const row = (
          await role.db.$client.query<{ login: string; unsafe: boolean }>(
            "select session_user as login,(rolsuper or rolbypassrls or rolcreatedb or rolcreaterole) as unsafe from pg_roles where rolname=session_user",
          )
        ).rows[0];
        if (row?.login !== role.login || row.unsafe !== false)
          throw Error("public_expert_role_invalid");
        const privilege = (
          await role.db.$client.query<{ capable: boolean; tables: boolean }>(
            "select (select bool_and(has_function_privilege(session_user,signature,'EXECUTE')) from unnest($1::text[]) signature) capable, (select bool_or(has_table_privilege(session_user,table_name,'SELECT,INSERT,UPDATE,DELETE')) from unnest(array['public.expert_residency_orders','public.expert_referral_ledger_entries','public.payer_receipt_contacts','public.public_expert_payment_requests']) table_name) tables",
            [
              signatures[name].map(
                (signature) => "early_bird_private." + signature,
              ),
            ],
          )
        ).rows[0];
        if (privilege?.capable !== true || privilege.tables !== false)
          throw Error("public_expert_capability_grants_invalid");
      }
    },
    async handle(notification: {
      event: string;
      object: { id: string };
    }): Promise<"absent" | "pending" | "complete"> {
      return track(
        bounded(
          undefined,
          async (signal): Promise<"absent" | "pending" | "complete"> => {
            if (!accepting) return "pending";
            const lookup = async (operation: string | null) =>
              (
                await config.connections.binder.db.execute<{ value: string[] }>(
                  sql`select early_bird_private.public_payment_hint(${notification.object.id},${operation}::uuid,${notification.event === "refund.succeeded"}) value`,
                )
              ).rows[0]?.value;
            let ids = await lookup(null);
            if (Array.isArray(ids) && ids.length === 0) {
              // The notification parser deliberately retains only the object ID.
              // Initially unbound objects discover their canonical request through a
              // fresh provider GET; even that metadata is only a lookup hint.
              const item =
                notification.event === "refund.succeeded"
                  ? await transport.getRefund(notification.object.id, signal)
                  : await transport.getPayment(notification.object.id, signal);
              if (item.id !== notification.object.id) return "pending";
              const hint = item.metadata?.operation_id;
              if (hint && /^[0-9a-f-]{36}$/iu.test(hint))
                ids = await lookup(hint);
            }
            if (!Array.isArray(ids) || ids.length > 3)
              throw Error("public_hint_invalid");
            if (!ids.length) return "absent";
            let complete = false;
            for (const id of ids) {
              const result = await recovery.recover(id, { signal });
              if (
                result.kind === "observed" &&
                result.observation.providerObjectId === notification.object.id
              )
                complete = true;
            }
            return complete ? "complete" : "pending";
          },
        ),
      );
    },
    runOnce,
    start() {
      if (!accepting || timer) return;
      timer = setInterval(() => {
        void runOnce().catch(() => undefined);
      }, 60000);
      timer.unref();
      void runOnce().catch(() => undefined);
    },
    async stop() {
      accepting = false;
      shutdown.abort();
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      // Aborted sockets settle before this returns. An already-started canonical
      // transaction is awaited to completion rather than orphaned by a timer.
      await Promise.allSettled([...active]);
    },
  };
}
export type PublicExpertPaymentRuntime = ReturnType<
  typeof createPublicExpertPaymentRuntime
>;
