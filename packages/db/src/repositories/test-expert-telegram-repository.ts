import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { reserveSelartiCost } from "./selarti-budget-repository.js";
import { hasCurrentTestExpertConsent } from "./test-expert-consent-authority.js";
import type { ClientConsentAuthority } from "@ii-tonya/contracts";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";

type Executor = Pick<DrizzleDb, "execute">;
type Scope = { botKey: string; telegramUserId: string; chatId: string };
type Session = {
  id?: string;
  version: number;
  state:
    | "awaiting_name"
    | "awaiting_specialization"
    | "awaiting_segment"
    | "ready"
    | "qualified"
    | "closed";
  name?: string;
  specialization?: string;
  segment?: "EXPERT" | "CENTER" | "ORGANIZER";
};
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const requestIdFor = (input: Scope & { requestKey: string }) =>
  `sha256:${sha256(`test-expert-selarti\0${input.botKey}\0${input.chatId}\0${input.requestKey}`)}`;
const validScope = (input: Scope) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.botKey) &&
  /^[1-9]\d{0,19}$/u.test(input.telegramUserId) &&
  input.chatId === input.telegramUserId;

export class PostgresTestExpertTelegramRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly consent: {
      messagingConsentPolicyVersion: string;
      selartiConsentPolicyVersion?: string;
    },
  ) {}

  private async consentGranted(
    executor: Executor,
    userId: string,
    residual = false,
  ) {
    if (residual && this.consent.selartiConsentPolicyVersion === undefined)
      return false;
    return hasCurrentTestExpertConsent(executor, {
      userId,
      messagingPolicyVersion: this.consent.messagingConsentPolicyVersion,
      ...(residual
        ? { selartiPolicyVersion: this.consent.selartiConsentPolicyVersion! }
        : {}),
    });
  }

  private async identity(executor: Executor, input: Scope) {
    if (!validScope(input)) return { kind: "not_found" as const };
    const rows = await executor.execute<{ userId: string }>(sql`
      select ci.user_id as "userId" from channel_identities ci
      join users u on u.id=ci.user_id and u.active=true
      where ci.provider='telegram' and ci.bot_key=${input.botKey}
        and ci.external_id=${input.telegramUserId}
        and ci.external_chat_id=${input.chatId} and ci.status='active'
      order by ci.id limit 2`);
    if (rows.rows.length !== 1)
      return {
        kind:
          rows.rows.length > 1
            ? ("ambiguous" as const)
            : ("not_found" as const),
      };
    return { kind: "resolved" as const, userId: rows.rows[0]!.userId };
  }

  async load(input: Scope) {
    return this.db.transaction(async (tx) => {
      const identity = await this.identity(tx, input);
      if (identity.kind !== "resolved") return identity;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${identity.userId},0))`,
      );
      if (!(await this.consentGranted(tx, identity.userId)))
        return { kind: "consent_denied" as const };
      const sessions = await tx.execute<{
        id: string;
        version: number;
        state: Session["state"];
        segment?: Session["segment"];
      }>(sql`
      select id,version,state,segment from test_expert_sessions
      where user_id=${identity.userId}::uuid and bot_key=${input.botKey}
        and external_chat_id=${input.chatId} and status='active'
      order by created_at desc,id desc limit 2`);
      if (sessions.rows.length > 1) return { kind: "ambiguous" as const };
      const row = sessions.rows[0];
      return {
        kind: "resolved" as const,
        userId: identity.userId,
        session: row
          ? {
              id: row.id,
              version: Number(row.version),
              state: row.state,
              ...(row.segment ? { segment: row.segment } : {}),
            }
          : null,
      };
    });
  }

  async deliverDeterministic(
    input: Scope & {
      userId: string;
      expectedSessionVersion: number | null;
      nextSession: Session;
      replyText: string;
      copyVersion: string;
      sellingActivation: "inactive";
      trialUnits: 0;
      requestKey: string;
      requestDigest: string;
      correlationId: string;
      occurredAt: string;
    },
  ) {
    if (
      input.trialUnits !== 0 ||
      input.sellingActivation !== "inactive" ||
      input.replyText.length < 1 ||
      input.replyText.length > 4_096 ||
      /[\u0000-\u001F\u007F-\u009F]/u.test(input.replyText) ||
      !/^[0-9a-f]{64}$/u.test(input.requestDigest)
    )
      throw new Error("test_expert_deterministic_input_invalid");
    return this.db.transaction(async (tx) => {
      const identity = await this.identity(tx, input);
      if (identity.kind !== "resolved" || identity.userId !== input.userId)
        throw new Error("test_expert_identity_ambiguous");
      await lockClientConsentSubject(tx, input.userId);
      const consentAuthority = await captureClientConsentAuthority(tx, {
        subjectId: input.userId,
        botKey: input.botKey,
        chatId: input.chatId,
        externalUserId: input.telegramUserId,
        messagingPolicyVersion: this.consent.messagingConsentPolicyVersion,
      });
      if (!consentAuthority) throw new Error("test_expert_consent_denied");
      const dialogueId = await this.ensureDialogue(tx, input, input.userId);
      const deliveryKey = `sha256:${sha256(`test-expert-delivery\0${input.botKey}\0${input.requestKey}`)}`;
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${sha256(`${input.botKey}\0${input.requestKey}`)},0)
        )
      `);
      const existing = await tx.execute<{ requestDigest: string }>(sql`
        select request_digest as "requestDigest"
        from test_expert_deterministic_requests
        where bot_key=${input.botKey} and request_key=${input.requestKey}
        limit 2 for update`);
      if (existing.rows.length === 1) {
        if (existing.rows[0]!.requestDigest !== input.requestDigest)
          throw new Error("request_idempotency_conflict");
        return { kind: "duplicate" as const, replay: true };
      }
      if (existing.rows.length > 1)
        throw new Error("test_expert_delivery_ambiguous");
      const sessionId = await this.advanceSession(tx, { ...input, dialogueId });
      const outboxId = await this.enqueueTelegram(tx, {
        dialogueId,
        sessionId,
        botKey: input.botKey,
        chatId: input.chatId,
        replyText: input.replyText,
        correlationId: input.correlationId,
        deliveryKey,
        consentAuthority,
      });
      await tx.execute(sql`
        insert into test_expert_deterministic_requests(
          session_id,outbox_id,bot_key,request_key,request_digest
        ) values(
          ${sessionId}::uuid,${outboxId}::uuid,${input.botKey},${input.requestKey},${input.requestDigest}
        )
      `);
      return { kind: "applied" as const, replay: false };
    });
  }

  async enqueueResidual(
    input: Scope & {
      userId: string;
      sessionId: string;
      expectedSessionVersion: number;
      text: string;
      providerCalls: 1;
      requestKey: string;
      requestDigest: string;
      correlationId: string;
      occurredAt: string;
    },
  ) {
    const providerRequestId = requestIdFor(input);
    if (
      input.providerCalls !== 1 ||
      input.text.length < 1 ||
      input.text.length > 4_096 ||
      /[\u0000-\u001F\u007F-\u009F]/u.test(input.text) ||
      !/^[0-9a-f]{64}$/u.test(input.requestDigest)
    )
      throw new Error("test_expert_residual_input_invalid");
    try {
      return await this.db.transaction(async (tx) => {
        const identity = await this.identity(tx, input);
        if (identity.kind !== "resolved" || identity.userId !== input.userId)
          throw new Error("test_expert_identity_ambiguous");
        await lockClientConsentSubject(tx, input.userId);
        const consentAuthority =
          this.consent.selartiConsentPolicyVersion === undefined
            ? undefined
            : await captureClientConsentAuthority(tx, {
                subjectId: input.userId,
                botKey: input.botKey,
                chatId: input.chatId,
                externalUserId: input.telegramUserId,
                messagingPolicyVersion:
                  this.consent.messagingConsentPolicyVersion,
                selartiPolicyVersion: this.consent.selartiConsentPolicyVersion,
              });
        if (!consentAuthority) throw new Error("test_expert_consent_denied");
        const sessionRows = await tx.execute<{
          id: string;
          version: number;
          dialogueId: string;
          campaignVersionId?: string;
        }>(sql`
          select id,version,dialogue_id as "dialogueId",campaign_version_id as "campaignVersionId"
          from test_expert_sessions where id=${input.sessionId}::uuid
            and user_id=${input.userId}::uuid and bot_key=${input.botKey}
            and external_chat_id=${input.chatId} and state in ('ready','qualified') and status='active'
          for update`);
        const session = sessionRows.rows[0];
        if (
          !session ||
          Number(session.version) !== input.expectedSessionVersion
        )
          throw new Error("test_expert_session_conflict");
        const campaigns = await tx.execute<{
          id: string;
          promptVersion: string;
        }>(sql`
          select c.id,(p.asset_key||'@'||p.version::text) as "promptVersion"
          from test_expert_campaign_versions c
          join test_expert_prompt_assets p on p.id=c.prompt_asset_id and p.version=c.prompt_asset_version
          where c.code='test-expert' and c.status='active' and p.status='approved'
            and p.official_contract_evidence is not null
            and c.effective_from<=transaction_timestamp()
            and (c.effective_to is null or c.effective_to>transaction_timestamp())
          order by c.version desc limit 2`);
        if (campaigns.rows.length !== 1)
          return { kind: "not_applied" as const, replay: false };
        const campaign = campaigns.rows[0]!;
        if (
          session.campaignVersionId &&
          session.campaignVersionId !== campaign.id
        )
          throw new Error("test_expert_campaign_conflict");
        const redemptionKey = `test-expert:${campaign.id}:${input.userId}`;
        const redemption = await tx.execute<{
          id: string;
          created: boolean;
        }>(sql`
          insert into test_expert_redemptions(campaign_version_id,user_id,redemption_idempotency_key)
          values(${campaign.id}::uuid,${input.userId}::uuid,${redemptionKey})
          on conflict(redemption_idempotency_key) do update set redemption_idempotency_key=excluded.redemption_idempotency_key
          returning id,(xmax=0) as created`);
        const redemptionId = redemption.rows[0]!.id;
        await tx.execute(sql`
          update test_expert_sessions
          set campaign_version_id=${campaign.id}::uuid,
              redemption_id=${redemptionId}::uuid,
              state='qualified',updated_at=transaction_timestamp()
          where id=${session.id}::uuid`);
        await tx.execute(
          sql`select id from test_expert_redemptions where id=${redemptionId}::uuid for update`,
        );
        const prior = await tx.execute<{
          reservationId: string;
          requestDigest: string;
          status: "reserved" | "unknown" | "applied" | "not_applied";
          providerRequestId?: string;
        }>(sql`
          select id as "reservationId",request_digest as "requestDigest",status,provider_request_id as "providerRequestId"
          from test_expert_reservations where redemption_id=${redemptionId}::uuid and request_key=${input.requestKey} for update`);
        if (prior.rows[0]) {
          if (prior.rows[0].requestDigest !== input.requestDigest)
            throw new Error("request_idempotency_conflict");
          return {
            kind:
              prior.rows[0].status === "reserved"
                ? ("unknown" as const)
                : prior.rows[0].status,
            ...(prior.rows[0].providerRequestId === undefined
              ? {}
              : { providerRequestId: prior.rows[0].providerRequestId }),
            replay: true,
            redemptionCreated: false,
            reservationCreated: false,
          };
        }
        const capacity = await tx.execute<{ available: boolean }>(sql`
          select consumed_units+reserved_units+2<=granted_units as available from test_expert_redemptions where id=${redemptionId}::uuid`);
        if (capacity.rows[0]?.available !== true)
          return {
            kind: "limit_reached" as const,
            replay: false,
            reservationCreated: false,
          };
        const reservation = await tx.execute<{ id: string }>(sql`
          insert into test_expert_reservations(redemption_id,request_key,request_digest,units,status,provider_request_id)
          values(${redemptionId}::uuid,${input.requestKey},${input.requestDigest},2,'reserved',${providerRequestId}) returning id`);
        const reservationId = reservation.rows[0]!.id;
        await tx.execute(
          sql`update test_expert_redemptions set reserved_units=reserved_units+2 where id=${redemptionId}::uuid`,
        );
        await tx.execute(
          sql`insert into test_expert_audit_events(redemption_id,reservation_id,event_type,event_digest) values(${redemptionId}::uuid,${reservationId}::uuid,'units_reserved',${input.requestDigest})`,
        );
        const admission = await reserveSelartiCost(tx, {
          requestId: providerRequestId,
          payloadHash: input.requestDigest,
          userId: input.userId,
          dialogueId: session.dialogueId,
          occurredAt: input.occurredAt,
        });
        if (
          admission.outcome === "soft_stop" ||
          admission.outcome === "hard_stop"
        ) {
          await this.transition(tx, {
            redemptionId,
            reservationId,
            outcome: "not_applied",
            providerRequestId,
          });
          await this.enqueueTelegram(tx, {
            dialogueId: session.dialogueId,
            sessionId: session.id,
            botKey: input.botKey,
            chatId: input.chatId,
            replyText:
              "Сейчас расширенный ответ недоступен: безопасный бюджетный лимит не разрешил отправку.",
            correlationId: input.correlationId,
            deliveryKey: `sha256:${sha256(`test-expert-denial\0${input.requestKey}`)}`,
            consentAuthority,
          });
          return {
            kind: "not_applied" as const,
            providerRequestId,
            replay: false,
            reservationCreated: true,
          };
        }
        const request = {
          requestId: providerRequestId,
          dialogueId: session.dialogueId,
          userId: input.userId,
          correlationId: input.correlationId,
          text: input.text,
          locale: "ru-RU",
          promptVersion: campaign.promptVersion,
          deadline: new Date(
            new Date(input.occurredAt).getTime() + 30_000,
          ).toISOString(),
          consentAuthority,
        };
        await tx.execute(sql`
          insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash)
          values(${providerRequestId},'selarti.request.v1',${JSON.stringify(request)}::jsonb,${input.correlationId},${providerRequestId},${input.requestDigest})`);
        return {
          kind: "pending" as const,
          providerRequestId,
          replay: false,
          redemptionCreated: redemption.rows[0]!.created,
          reservationCreated: true,
        };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "test_expert_identity_ambiguous",
          "test_expert_session_conflict",
          "test_expert_campaign_conflict",
          "test_expert_consent_denied",
          "request_idempotency_conflict",
        ].includes(error.message)
      )
        throw error;
      return this.recoverAmbiguous(providerRequestId);
    }
  }

  async scan(input: { limit: number; before: Date }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new Error("test_expert_scan_limit_invalid");
    const rows = await this.db.execute<{
      reservationId: string;
      providerRequestId: string;
      createdAt: Date;
    }>(sql`
      select id as "reservationId",provider_request_id as "providerRequestId",created_at as "createdAt" from test_expert_reservations
      where status in ('reserved','unknown') and provider_request_id is not null and created_at<${input.before} order by created_at,id limit ${input.limit}`);
    return rows.rows;
  }

  async resolveAuthoritativeOutcome(providerRequestId: string) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(providerRequestId))
      throw new Error("provider_request_id_invalid");
    const facts = await this.db.execute<{
      requestCount: number;
      responseCount: number;
      authoritativeNotAppliedCount: number;
    }>(sql`
      select count(distinct o.id)::integer as "requestCount",
        count(distinct p.id)::integer as "responseCount",
        count(distinct case when o.status='dead_letter' and o.last_normalized_reason='provider_not_applied' then o.id end)::integer as "authoritativeNotAppliedCount"
      from integration_outbox o
      left join selarti_response_proposals p on p.request_id=o.idempotency_key
      where o.idempotency_key=${providerRequestId} and o.topic='selarti.request.v1'`);
    const fact = facts.rows[0];
    if (
      !fact ||
      fact.requestCount !== 1 ||
      fact.responseCount > 1 ||
      fact.authoritativeNotAppliedCount > 1
    )
      return "unknown" as const;
    if (fact.responseCount === 1) return "applied" as const;
    if (fact.authoritativeNotAppliedCount === 1) return "not_applied" as const;
    return "unknown" as const;
  }

  async recordAuthoritativeOutcome(
    reservationId: string,
    providerRequestId: string,
    outcome: "applied" | "not_applied",
  ) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        redemptionId: string;
        status: "reserved" | "unknown" | "applied" | "not_applied";
        providerRequestId?: string;
      }>(sql`
        select redemption_id as "redemptionId",status,provider_request_id as "providerRequestId" from test_expert_reservations where id=${reservationId}::uuid for update`);
      const row = rows.rows[0];
      if (!row) throw new Error("reservation_not_found");
      if (row.status === "applied" || row.status === "not_applied")
        return row.status;
      if (row.providerRequestId !== providerRequestId)
        throw new Error("provider_request_id_conflict");
      await this.transition(tx, {
        redemptionId: row.redemptionId,
        reservationId,
        outcome,
        providerRequestId,
      });
    });
  }

  private async recoverAmbiguous(providerRequestId: string) {
    const rows = await this.db.execute<{
      reservationId: string;
      redemptionId: string;
      status: "reserved" | "unknown" | "applied" | "not_applied";
    }>(sql`
      select id as "reservationId",redemption_id as "redemptionId",status from test_expert_reservations where provider_request_id=${providerRequestId} limit 2`);
    if (rows.rows.length === 0)
      return {
        kind: "not_applied" as const,
        providerRequestId,
        replay: false,
        reservationCreated: false,
      };
    if (rows.rows.length !== 1)
      return {
        kind: "unknown" as const,
        providerRequestId,
        replay: true,
        reservationCreated: false,
      };
    const row = rows.rows[0]!;
    if (row.status !== "reserved")
      return {
        kind: row.status,
        providerRequestId,
        replay: true,
        reservationCreated: false,
      };
    await this.db.transaction((tx) =>
      this.transition(tx, {
        redemptionId: row.redemptionId,
        reservationId: row.reservationId,
        outcome: "unknown",
        providerRequestId,
      }),
    );
    return {
      kind: "unknown" as const,
      providerRequestId,
      replay: false,
      reservationCreated: true,
    };
  }

  private async ensureDialogue(
    executor: Executor,
    input: Scope,
    userId: string,
  ) {
    const rows = await executor.execute<{ id: string; userId: string }>(sql`
      insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id)
      values(${input.botKey},${userId}::uuid,'telegram',${input.botKey},${input.chatId})
      on conflict(tenant_key,provider,bot_key,external_chat_id) do update set tenant_key=excluded.tenant_key
      returning id,user_id as "userId"`);
    if (rows.rows.length !== 1 || rows.rows[0]!.userId !== userId)
      throw new Error("test_expert_dialogue_ambiguous");
    return rows.rows[0]!.id;
  }

  private async advanceSession(
    executor: Executor,
    input: Scope & {
      userId: string;
      dialogueId: string;
      expectedSessionVersion: number | null;
      nextSession: Session;
      copyVersion: string;
    },
  ) {
    const active = await executor.execute<{ id: string; version: number }>(sql`
      select id,version from test_expert_sessions where user_id=${input.userId}::uuid and bot_key=${input.botKey}
        and external_chat_id=${input.chatId} and status='active' order by created_at desc,id desc limit 2 for update`);
    if (input.expectedSessionVersion === null) {
      if (active.rows.length !== 0)
        throw new Error("test_expert_session_conflict");
      const inserted = await executor.execute<{ id: string }>(sql`
        insert into test_expert_sessions(user_id,dialogue_id,bot_key,external_chat_id,state,version,segment,name_digest,specialization_digest,copy_version,selling_activation)
        values(${input.userId}::uuid,${input.dialogueId}::uuid,${input.botKey},${input.chatId},${input.nextSession.state},${input.nextSession.version},${input.nextSession.segment ?? null},${input.nextSession.name ? sha256(input.nextSession.name) : null},${input.nextSession.specialization ? sha256(input.nextSession.specialization) : null},${input.copyVersion},'inactive') returning id`);
      return inserted.rows[0]!.id;
    }
    if (
      active.rows.length !== 1 ||
      Number(active.rows[0]!.version) !== input.expectedSessionVersion
    )
      throw new Error("test_expert_session_conflict");
    await executor.execute(sql`
      update test_expert_sessions set state=${input.nextSession.state},version=${input.nextSession.version},segment=${input.nextSession.segment ?? null},
        name_digest=coalesce(${input.nextSession.name ? sha256(input.nextSession.name) : null},name_digest),
        specialization_digest=coalesce(${input.nextSession.specialization ? sha256(input.nextSession.specialization) : null},specialization_digest),
        copy_version=${input.copyVersion},updated_at=transaction_timestamp() where id=${active.rows[0]!.id}::uuid`);
    return active.rows[0]!.id;
  }

  private async enqueueTelegram(
    executor: Executor,
    input: {
      dialogueId: string;
      sessionId: string;
      botKey: string;
      chatId: string;
      replyText: string;
      correlationId: string;
      deliveryKey: string;
      consentAuthority: ClientConsentAuthority;
    },
  ) {
    const sequence = await executor.execute<{ sequence: bigint }>(sql`
      update dialogues set next_delivery_sequence=next_delivery_sequence+1 where id=${input.dialogueId}::uuid returning next_delivery_sequence as sequence`);
    if (sequence.rows.length !== 1)
      throw new Error("test_expert_dialogue_missing");
    const deliveryId = randomUUID();
    const outboxId = randomUUID();
    const payload = {
      deliveryId,
      dialogueId: input.dialogueId,
      sequence: Number(sequence.rows[0]!.sequence),
      botKey: input.botKey,
      chatId: input.chatId,
      text: input.replyText,
      consentAuthority: input.consentAuthority,
    };
    const payloadHash = sha256(JSON.stringify(payload));
    await executor.execute(sql`
      insert into integration_outbox(id,idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash,dialogue_id,dialogue_sequence)
      values(${outboxId}::uuid,${input.deliveryKey},'telegram.send_text.v1',${JSON.stringify(payload)}::jsonb,${input.correlationId},${input.deliveryKey},${payloadHash},${input.dialogueId}::uuid,${sequence.rows[0]!.sequence})`);
    await executor.execute(sql`
      insert into dialogue_deliveries(id,dialogue_id,dialogue_sequence,source,source_id,outbox_id,payload_hash)
      values(${deliveryId}::uuid,${input.dialogueId}::uuid,${sequence.rows[0]!.sequence},'deterministic',${input.sessionId}::uuid,${outboxId}::uuid,${payloadHash})`);
    return outboxId;
  }

  private async transition(
    executor: Executor,
    input: {
      redemptionId: string;
      reservationId: string;
      outcome: "applied" | "not_applied" | "unknown";
      providerRequestId: string;
    },
  ) {
    const current = await executor.execute<{
      status: "reserved" | "unknown" | "applied" | "not_applied";
      providerRequestId?: string;
    }>(sql`
      select status,provider_request_id as "providerRequestId"
      from test_expert_reservations where id=${input.reservationId}::uuid
        and redemption_id=${input.redemptionId}::uuid for update`);
    if (current.rows.length !== 1) throw new Error("reservation_not_found");
    const row = current.rows[0]!;
    if (row.providerRequestId !== input.providerRequestId)
      throw new Error("provider_request_id_conflict");
    if (row.status === input.outcome) return;
    if (row.status === "applied" || row.status === "not_applied")
      throw new Error("reservation_outcome_conflict");
    if (input.outcome === "unknown") {
      if (row.status !== "reserved")
        throw new Error("reservation_outcome_conflict");
      await executor.execute(
        sql`update test_expert_reservations set status='unknown' where id=${input.reservationId}::uuid`,
      );
    } else {
      await executor.execute(
        sql`update test_expert_reservations set status=${input.outcome} where id=${input.reservationId}::uuid`,
      );
      await executor.execute(
        sql`update test_expert_redemptions set reserved_units=reserved_units-2,consumed_units=consumed_units+case when ${input.outcome}='applied' then 2 else 0 end where id=${input.redemptionId}::uuid`,
      );
    }
    await executor.execute(
      sql`insert into test_expert_outcomes(reservation_id,outcome,provider_request_id) values(${input.reservationId}::uuid,${input.outcome},${input.providerRequestId}) on conflict do nothing`,
    );
    await executor.execute(
      sql`insert into test_expert_audit_events(redemption_id,reservation_id,event_type) values(${input.redemptionId}::uuid,${input.reservationId}::uuid,${`outcome_${input.outcome}`})`,
    );
  }
}
