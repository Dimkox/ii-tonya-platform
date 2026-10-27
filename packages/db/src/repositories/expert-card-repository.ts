import { privateObjectErasureSubjectKey } from "./resident-private-erasure.js";
import {
  emptyRichProfile,
  richProfileSchema,
  richProfilePatchSchema,
  richProposalSchema,
  type RichProposal,
  richServiceSchema,
  richProfileGaps,
  richPreviewPages,
  richReadablePages,
  guidedRichQuestion,
  guidedRichAnswer,
  type GuidedService,
  type RichProfile,
  proposeRichFields,
} from "@ii-tonya/contracts";
import {
  assessResidentContent,
  residentSafetyFields,
  recordResidentSafety,
  residentSafetyOutcome,
  type ResidentSafetyAssessment,
} from "./resident-content-safety.js";
import { issueOwnedWorkHandoff } from "./resident-workspace-repository.js";
import {
  PostgresExpertApplicationMaterials,
  applicationProofDigest,
} from "./expert-application-materials.js";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { ExpertPromoScope } from "./expert-promo-repository.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import { originalClientConsentSql } from "./consent-current.js";
import {
  lockExpertManagerAuthority,
  ExpertManagerAuthorityError,
} from "./expert-manager-authority.js";
export type ExpertCardTransaction = Parameters<
  Parameters<DrizzleDb["transaction"]>[0]
>[0];
export interface ExpertCardEvent extends ExpertPromoScope {
  requestKey: string;
  requestDigest: string;
}
export interface ProfessionalCard {
  displayName: string;
  profession: string;
  city: string;
  summary: string;
}
export type CardEntry =
  | { kind: "text"; text: string }
  | { kind: "photo" | "document"; reference: string };
export type CardPromoProof = {
  kind: "link" | "photo" | "document";
  reference: string;
};
export type CardStatus =
  "collecting" | "manager_review" | "changes_requested" | "approved";
export interface CardWorkflow {
  assistanceRequested?: boolean;
  returnReason?: string | null;
  applicationId: string;
  draftId: string | null;
  revision: number;
  status: CardStatus;
  entryCount: number;
  materialStatus:
    "none" | "waiting_content" | "pending" | "delivered" | "unknown_outcome";
  promoConfirmed: boolean;
  activeResident: boolean;
}
export interface CardActivationGate {
  applicationId: string;
  userId: string;
  draftId: string;
  reviewId: string;
  revision: number;
  publicPayload: ProfessionalCard;
  publicDigest: string;
  messagingConsentPolicyVersion: string;
}
export interface ExpertCardMaterialPayload {
  text: string;
  assets: readonly { kind: "photo" | "document"; reference: string }[];
}
export interface ExpertCardMaterialTransport {
  send(input: {
    botId: string;
    botKey: string;
    userId: string;
    chatId: string;
    reviewId: string;
    revision: number;
    materialPurpose?: "application_generic";
    applicationId?: string;
    contentVersion: string;
    payloadDigest: string;
    payload: ExpertCardMaterialPayload;
    signal: AbortSignal;
  }): Promise<{
    messageIds: readonly string[];
    botId: string;
    chatId: string;
    contentVersion: string;
    payloadDigest: string;
  }>;
}
export class ExpertCardError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpertCardError";
  }
}
const fail = (code: string): never => {
  throw new ExpertCardError(code);
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const id =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forbiddenControl =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u;
function record(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("|") !== [...keys].sort().join("|")
  )
    return fail(code);
  return value as Record<string, unknown>;
}
export function decodeProfessionalCard(value: unknown): ProfessionalCard {
  const code = "card_invalid_public_payload";
  const raw = record(
    value,
    ["displayName", "profession", "city", "summary"],
    code,
  );
  const limits = { displayName: 80, profession: 120, city: 80, summary: 2000 };
  const result = {} as ProfessionalCard;
  for (const key of Object.keys(limits) as (keyof ProfessionalCard)[]) {
    const original = raw[key];
    const text =
      typeof original === "string" ? original.normalize("NFKC") : original;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.trim().length > limits[key] ||
      forbiddenControl.test(text) ||
      /(?:https?:\/\/|www\.|telegram:file:|rfpg:|@|[0-9][0-9()+\s-]{7,}[0-9])/iu.test(
        text,
      )
    )
      return fail(code);
    result[key] = text.trim();
  }
  return result;
}
const media = (value: unknown) =>
  typeof value === "string" &&
  /^telegram:file:[A-Za-z0-9_-]{1,512}$/u.test(value);
export function decodeCardEntry(value: unknown): CardEntry {
  const raw = value as Record<string, unknown>;
  const code = "card_invalid_entry";
  if (raw?.kind === "text") {
    const r = record(value, ["kind", "text"], code);
    if (
      typeof r.text !== "string" ||
      !r.text.trim() ||
      r.text.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(r.text)
    )
      return fail(code);
    return { kind: "text", text: r.text };
  }
  const r = record(value, ["kind", "reference"], code);
  if ((r.kind !== "photo" && r.kind !== "document") || !media(r.reference))
    return fail(code);
  return { kind: r.kind, reference: r.reference as string };
}
function publicHttps(reference: string) {
  try {
    const url = new URL(reference);
    const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "::1" ||
      /^(?:fc|fd|fe80):/u.test(host)
    )
      return false;
    if (/^\d+\.\d+\.\d+\.\d+$/u.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b! >= 16 && b! <= 31) ||
        (a === 192 && b === 168) ||
        a! >= 224
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function decodeCardPromoProof(value: unknown): CardPromoProof {
  const code = "card_invalid_proof";
  const r = record(value, ["kind", "reference"], code);
  if (typeof r.reference !== "string") return fail(code);
  if (r.kind === "link") {
    if (
      r.reference.length > 2048 ||
      !publicHttps(r.reference) ||
      forbiddenControl.test(r.reference)
    )
      return fail(code);
    return { kind: "link", reference: r.reference };
  }
  if ((r.kind !== "photo" && r.kind !== "document") || !media(r.reference))
    return fail(code);
  return { kind: r.kind, reference: r.reference };
}
export function normalizeCardEvent(raw: ExpertCardEvent) {
  if (!raw || typeof raw !== "object") return fail("card_invalid_event");
  const scope = {
    botKey: raw.botKey,
    botId: raw.botId,
    telegramUserId: raw.telegramUserId,
    chatId: raw.chatId,
    requestKey: raw.requestKey,
    requestDigest: raw.requestDigest,
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(scope.botKey) ||
    !/^[1-9]\d{0,19}$/u.test(scope.botId) ||
    !/^[1-9]\d{0,19}$/u.test(scope.telegramUserId) ||
    scope.chatId !== scope.telegramUserId ||
    typeof scope.requestKey !== "string" ||
    !scope.requestKey.startsWith(`${scope.botId}:`) ||
    !/^[0-9a-f]{64}$/u.test(scope.requestDigest)
  )
    return fail("card_invalid_event");
  const updateId = scope.requestKey.slice(scope.botId.length + 1);
  if (!/^(?:0|[1-9]\d{0,19})$/u.test(updateId))
    return fail("card_invalid_event");
  return { ...scope, updateId };
}
const canonical = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return fail("card_invalid_event");
};
type Operation =
  | "tags_toggle"
  | "entry"
  | "submit"
  | "promo_proof"
  | "handoff_issue"
  | "handoff_redeem"
  | "main_quote"
  | "main_accept"
  | "main_checkout"
  | "residency_pause"
  | "residency_resume";
export interface StartedCardRequest {
  readonly userId: string;
  readonly replay: boolean;
  readonly resultId?: string;
}
type RequestData = {
  scope: ReturnType<typeof normalizeCardEvent>;
  userId: string;
  operation: Operation;
  semanticDigest: string;
};
const requests = new WeakMap<
  object,
  RequestData & { tx: ExpertCardTransaction }
>();
async function originalConsent(
  tx: ExpertCardTransaction,
  userId: string,
  expected?: string,
) {
  const rows = (
    await tx.execute<{ policyVersion: string }>(
      originalClientConsentSql(userId, "client_messaging"),
    )
  ).rows;
  return rows.length === 1 && (!expected || rows[0]!.policyVersion === expected)
    ? rows[0]!.policyVersion
    : null;
}
async function paidApplication(tx: ExpertCardTransaction, userId: string) {
  return (
    (
      await tx.execute<{ applicationId: string }>(
        sql`select a.id as "applicationId" from expert_onboarding_applications a join users u on u.id=a.user_id and u.active=true join expert_onboarding_invoices i on i.application_id=a.id and i.user_id=a.user_id and i.purpose='onboarding' and i.status='settled' join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.user_id=a.user_id and f.admission='interview' where a.user_id=${userId}::uuid and a.verification_status='approved' and a.onboarding_stage is not null and a.archived_at is null and a.archive_until_date is null for share of a,u`,
      )
    ).rows[0] ?? null
  );
}
type PrivateCardOwner = {
  userId: string;
  applicationId: string;
  policy: string;
};
async function owner(
  tx: ExpertCardTransaction,
  scope: ExpertPromoScope,
  expected?: string,
  residencyOnly?: false,
): Promise<PrivateCardOwner | null>;
async function owner(
  tx: ExpertCardTransaction,
  scope: ExpertPromoScope,
  expected: string | undefined,
  residencyOnly: true,
): Promise<{ userId: string; policy: string } | null>;
async function owner(
  tx: ExpertCardTransaction,
  scope: ExpertPromoScope,
  expected?: string,
  residencyOnly = false,
) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(scope.botKey) ||
    !/^[1-9]\d{0,19}$/u.test(scope.telegramUserId) ||
    scope.chatId !== scope.telegramUserId
  )
    return null;
  const identities = (
    await tx.execute<{ userId: string }>(
      sql`select ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active=true where ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' order by ci.id limit 2`,
    )
  ).rows;
  if (identities.length !== 1) return null;
  const userId = identities[0]!.userId;
  await lockClientConsentSubject(tx, userId);
  const policy = await originalConsent(tx, userId, expected);
  if (
    !policy ||
    !(await captureClientConsentAuthority(tx, {
      subjectId: userId,
      botKey: scope.botKey,
      chatId: scope.chatId,
      externalUserId: scope.telegramUserId,
      messagingPolicyVersion: policy,
    }))
  )
    return null;
  const application = await paidApplication(tx, userId);
  if (!application && residencyOnly) {
    const settled = (
      await tx.execute<{ id: string }>(
        sql`select o.id from expert_residency_orders o join experts e on e.id=o.expert_id where e.user_id=${userId}::uuid and o.status in('settled','refunded','charged_back') limit 1`,
      )
    ).rows[0];
    if (settled) return { userId, policy };
  }
  return application
    ? { userId, applicationId: application.applicationId, policy }
    : null;
}
async function startKnownRequest(
  tx: ExpertCardTransaction,
  scope: ReturnType<typeof normalizeCardEvent>,
  userId: string,
  operation: Operation,
  semanticDigest: string,
): Promise<StartedCardRequest> {
  const prior = (
    await tx.execute<{
      userId: string | null;
      operation: string;
      requestDigest: string | null;
      semanticDigest: string | null;
      resultId: string | null;
    }>(
      sql`select user_id as "userId",operation,request_digest as "requestDigest",semantic_digest as "semanticDigest",result_id as "resultId" from expert_card_requests where bot_id=${scope.botId} and update_id=${scope.updateId}`,
    )
  ).rows[0];
  if (
    prior &&
    (prior.userId !== userId ||
      prior.operation !== operation ||
      prior.requestDigest !== scope.requestDigest ||
      prior.semanticDigest !== semanticDigest)
  )
    return fail("card_idempotency_conflict");
  const started = Object.freeze({
    userId,
    replay: !!prior,
    ...(prior?.resultId ? { resultId: prior.resultId } : {}),
  });
  requests.set(started, { tx, scope, userId, operation, semanticDigest });
  return started;
}
export async function beginCardRequest(
  tx: ExpertCardTransaction,
  raw: ExpertCardEvent,
  operation: Operation,
  semanticPayload: unknown = null,
): Promise<StartedCardRequest> {
  const scope = normalizeCardEvent(raw);
  const semanticDigest = sha(canonical(semanticPayload));
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`card:${scope.botId}:${scope.updateId}`},0))`,
  );
  const identity =
    operation === "residency_pause" || operation === "residency_resume"
      ? await owner(tx, scope, undefined, true)
      : await owner(tx, scope);
  if (!identity) return fail("card_forbidden");
  return startKnownRequest(
    tx,
    scope,
    identity.userId,
    operation,
    semanticDigest,
  );
}
export async function finishCardRequest(
  tx: ExpertCardTransaction,
  started: StartedCardRequest,
  resultId?: string,
) {
  const data = requests.get(started);
  if (!data || data.tx !== tx) return fail("card_forbidden");
  if (started.replay) return;
  await tx.execute(
    sql`insert into expert_card_requests(bot_id,update_id,user_id,operation,request_digest,semantic_digest,result_id) values(${data.scope.botId},${data.scope.updateId},${data.userId}::uuid,${data.operation},${data.scope.requestDigest},${data.semanticDigest},${resultId ?? null}::uuid)`,
  );
}
export async function lockCardActivationGate(
  tx: ExpertCardTransaction,
  input: { applicationId: string; userId: string; reviewId?: string },
): Promise<CardActivationGate | null> {
  if (
    !id.test(input.applicationId) ||
    !id.test(input.userId) ||
    (input.reviewId !== undefined && !id.test(input.reviewId))
  )
    return null;
  await lockClientConsentSubject(tx, input.userId);
  const rows = (
    await tx.execute<{
      applicationId: string;
      userId: string;
      draftId: string;
      reviewId: string;
      revision: number;
      publicPayload: ProfessionalCard;
      publicDigest: string;
      messagingConsentPolicyVersion: string;
    }>(
      sql`select d.application_id as "applicationId",d.user_id as "userId",d.id as "draftId",r.id as "reviewId",r.revision,r.public_payload as "publicPayload",r.public_digest as "publicDigest",d.messaging_policy_version as "messagingConsentPolicyVersion" from expert_card_drafts d join expert_card_reviews r on r.id=${input.reviewId ? sql`${input.reviewId}::uuid` : sql`coalesce((select v.review_id from resident_card_versions v where v.draft_id=d.id order by v.revision desc limit 1),d.approved_review_id)`} and r.draft_id=d.id and r.user_id=d.user_id and (r.id=d.approved_review_id or exists(select 1 from resident_card_versions v where v.review_id=r.id)) where d.application_id=${input.applicationId}::uuid and d.user_id=${input.userId}::uuid ${input.reviewId ? sql`and r.id=${input.reviewId}::uuid` : sql``} for update of d for share of r`,
    )
  ).rows;
  const row = rows[0];
  if (rows.length !== 1 || !row) return null;
  const activeUser = (
    await tx.execute<{ active: boolean }>(
      sql`select active from users where id=${input.userId}::uuid for share`,
    )
  ).rows[0]?.active;
  if (activeUser !== true) return null;
  const consentEpoch = (
    await tx.execute(
      sql`select revision from consent_states where user_id=${input.userId}::uuid and purpose='client_messaging' for share`,
    )
  ).rows;
  const noticeEpoch = (
    await tx.execute(
      sql`select revision from expert_card_consent_epoch where id=1 for share`,
    )
  ).rows;
  const draftScope = (
    await tx.execute<{ botKey: string; chatId: string }>(
      sql`select work_bot_key as "botKey",work_chat_id as "chatId" from expert_card_drafts where id=${row.draftId}::uuid`,
    )
  ).rows[0];
  if (!consentEpoch.length || !noticeEpoch.length || !draftScope) return null;
  const identities = (
    await tx.execute(
      sql`select id from channel_identities where user_id=${input.userId}::uuid and provider='telegram' and bot_key=${draftScope.botKey} and external_id=${draftScope.chatId} and external_chat_id=${draftScope.chatId} and status='active' for share`,
    )
  ).rows;
  if (identities.length !== 1) return null;

  await tx.execute(
    sql`select j.id from expert_card_material_jobs j where j.review_id=${row.reviewId}::uuid for share`,
  );
  await tx.execute(
    sql`select p.id from expert_card_promo_confirmations p where p.review_id=${row.reviewId}::uuid for share`,
  );
  await tx.execute(
    sql`select p.id from expert_card_promo_proofs p where p.review_id=${row.reviewId}::uuid for share`,
  );
  if (
    !(await originalConsent(
      tx,
      input.userId,
      row.messagingConsentPolicyVersion,
    ))
  )
    return null;
  await tx.execute(
    sql`select application_id from expert_application_promo_confirmations where application_id=${row.applicationId}::uuid for share`,
  );
  await tx.execute(
    sql`select id from expert_application_promo_proofs where application_id=${row.applicationId}::uuid for share`,
  );
  const valid = (
    await tx.execute<{ valid: boolean }>(
      sql`select expert_card_activation_gate_valid(${input.userId}::uuid,${row.reviewId}::uuid) as valid`,
    )
  ).rows[0]?.valid;
  if (valid !== true) return null;
  try {
    const validated = decodeProfessionalCard(row.publicPayload);
    if (canonical(validated) !== canonical(row.publicPayload)) return null;
    return { ...row, publicPayload: validated };
  } catch (error) {
    if (
      error instanceof ExpertCardError &&
      error.code === "card_invalid_public_payload"
    )
      return null;
    throw error;
  }
}
type DraftRow = {
  id: string;
  applicationId: string;
  userId: string;
  revision: number;
  status: CardStatus;
  publicCard: ProfessionalCard | null;
  approvedReviewId: string | null;
  policy: string;
  botId: string;
  botKey: string;
  chatId: string;
};
type StaffCommand = {
  sessionHash: string;
  applicationId: string;
  expectedRevision: number;
  idempotencyKey: string;
};
function richSafetyFields(profile: RichProfile): Record<string, string> {
  const { services, photos: _photos, ...rest } = profile;
  void _photos;
  return Object.fromEntries([
    ["rich:profile", JSON.stringify(rest)],
    ...services.map((s, i) => [`rich:service:${i}`, JSON.stringify(s)]),
  ]);
}
export interface CardPhotoCustody {
  read(input: {
    botId: string;
    fileId: string;
    size: number;
    mimeType: string;
    signal: AbortSignal;
  }): Promise<Uint8Array | null>;
  put(input: {
    key: string;
    custodyId: string;
    sha256: string;
    size: number;
    mimeType: string;
    bytes: Uint8Array;
    signal: AbortSignal;
  }): Promise<boolean>;
  presign(input: {
    key: string;
    custodyId: string;
    sha256: string;
    size: number;
    mimeType: string;
  }): Promise<string>;
}
const shaBytes = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class PostgresExpertCardRepository {
  private readonly richOnboarding: boolean;
  private readonly photoCustody: CardPhotoCustody | undefined;
  private readonly geocode:
    | ((
        address: string,
        signal: AbortSignal,
      ) => Promise<{ kind: "located"; url: string } | { kind: "unavailable" }>)
    | undefined;
  private readonly policy: Readonly<{
    messagingConsentPolicyVersion: string;
    workBotId: string;
    workBotKey: string;
  }>;
  private readonly transport: ExpertCardMaterialTransport | undefined;
  constructor(
    private readonly db: DrizzleDb,
    options: {
      messagingConsentPolicyVersion: string;
      workBotId: string;
      workBotKey: string;
      materialTransport?: ExpertCardMaterialTransport;
      richOnboarding?: boolean;
      photoCustody?: CardPhotoCustody;
      geocode?: (
        address: string,
        signal: AbortSignal,
      ) => Promise<{ kind: "located"; url: string } | { kind: "unavailable" }>;
    },
  ) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
        options.messagingConsentPolicyVersion,
      ) ||
      !/^[1-9]\d{0,19}$/u.test(options.workBotId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.workBotKey)
    )
      fail("card_invalid_configuration");
    this.richOnboarding = options.richOnboarding ?? false;
    this.photoCustody = options.photoCustody;
    this.geocode = options.geocode;
    this.policy = Object.freeze({
      messagingConsentPolicyVersion: options.messagingConsentPolicyVersion,
      workBotId: options.workBotId,
      workBotKey: options.workBotKey,
    });
    this.transport = options.materialTransport
      ? { send: options.materialTransport.send.bind(options.materialTransport) }
      : undefined;
  }
  private async tx<T>(
    work: (tx: ExpertCardTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof ExpertCardError) throw error;
      if (error instanceof ExpertManagerAuthorityError)
        throw new ExpertCardError("card_forbidden");
      throw new ExpertCardError("card_storage_unavailable");
    }
  }
  private work(scope: ExpertPromoScope) {
    return (
      scope.botId === this.policy.workBotId &&
      scope.botKey === this.policy.workBotKey &&
      scope.chatId === scope.telegramUserId
    );
  }
  private revision(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= 1000000)
      fail("card_revision_conflict");
  }
  private async draft(tx: ExpertCardTransaction, userId: string) {
    return (
      (
        await tx.execute<DraftRow>(
          sql`select id,application_id as "applicationId",user_id as "userId",revision,status,public_payload as "publicCard",approved_review_id as "approvedReviewId",messaging_policy_version as policy,work_bot_id as "botId",work_bot_key as "botKey",work_chat_id as "chatId" from expert_card_drafts where user_id=${userId}::uuid for update`,
        )
      ).rows[0] ?? null
    );
  }
  private async ensureDraft(
    tx: ExpertCardTransaction,
    userId: string,
    scope: ExpertPromoScope,
  ) {
    let draft = await this.draft(tx, userId);
    if (!draft) {
      const app = await paidApplication(tx, userId);
      if (!app) return fail("card_forbidden");
      await tx.execute(
        sql`insert into expert_card_drafts(application_id,user_id,messaging_policy_version,work_bot_id,work_bot_key,work_chat_id,rich_mode,rich_profile) values(${app.applicationId}::uuid,${userId}::uuid,${this.policy.messagingConsentPolicyVersion},${scope.botId},${scope.botKey},${scope.chatId},${this.richOnboarding},${this.richOnboarding ? JSON.stringify(emptyRichProfile()) : null}::jsonb)`,
      );
      draft = await this.draft(tx, userId);
    }
    if (
      !draft ||
      draft.botId !== scope.botId ||
      draft.botKey !== scope.botKey ||
      draft.chatId !== scope.chatId
    )
      return fail("card_forbidden");
    return draft;
  }
  private async workflow(
    tx: ExpertCardTransaction,
    userId: string,
    applicationId: string,
  ): Promise<CardWorkflow> {
    const row = (
      await tx.execute<{
        draftId: string;
        revision: number;
        status: CardStatus;
        entryCount: number;
        materialStatus: CardWorkflow["materialStatus"];
        promoConfirmed: boolean;
        assistanceRequested: boolean;
        returnReason: string | null;
      }>(
        sql`select (select r.return_reason from expert_card_reviews r where r.draft_id=d.id and r.revision=d.revision and r.action='return_changes' order by r.created_at desc,r.id desc limit 1) as "returnReason",(d.assistance_requested_at is not null and d.assistance_resolved_at is null) as "assistanceRequested",d.id as "draftId",d.revision,d.status,(select count(*)::int from expert_card_entries e where e.draft_id=d.id) as "entryCount",coalesce((select case when j.status='cancelled' then 'none' else j.status end from expert_card_material_jobs j where j.review_id=d.approved_review_id),'none') as "materialStatus",expert_card_activation_gate_valid(d.user_id,d.approved_review_id) as "promoConfirmed" from expert_card_drafts d where d.user_id=${userId}::uuid and d.application_id=${applicationId}::uuid`,
      )
    ).rows[0];
    const active =
      (
        await tx.execute<{ active: boolean }>(
          sql`select exists(select 1 from experts e join experts_published p on p.expert_id=e.id and p.user_id=e.user_id and p.active and p.next_billing_date>clock_timestamp() where e.user_id=${userId}::uuid and e.active and e.verified and exists(select 1 from expert_residency_orders o where o.expert_id=e.id and o.status='settled' and o.residency_starts_at<=clock_timestamp() and o.residency_ends_at>clock_timestamp())) as active`,
        )
      ).rows[0]?.active === true;
    const appMaterial = (
      await tx.execute<{ status: CardWorkflow["materialStatus"] }>(
        sql`select case when status='cancelled' then 'none' else status end as status from expert_application_material_jobs where application_id=${applicationId}::uuid and user_id=${userId}::uuid`,
      )
    ).rows[0];
    const appConfirmed =
      (
        await tx.execute<{ ready: boolean }>(
          sql`select exists(select 1 from expert_application_promo_confirmations p where p.application_id=${applicationId}::uuid and p.user_id=${userId}::uuid and p.proof_digest=${await applicationProofDigest(tx, applicationId)}) as ready`,
        )
      ).rows[0]?.ready === true;
    return {
      applicationId,
      draftId: row?.draftId ?? null,
      revision: row?.revision ?? 0,
      status: row?.status ?? "collecting",
      entryCount: row?.entryCount ?? 0,
      materialStatus:
        row?.materialStatus !== "none"
          ? (row?.materialStatus ?? "none")
          : (appMaterial?.status ?? "none"),
      promoConfirmed: appConfirmed || (row?.promoConfirmed ?? false),
      activeResident: active,
      assistanceRequested: row?.assistanceRequested ?? false,
      returnReason: row?.returnReason ?? null,
    };
  }
  async getWorkflow(scope: ExpertPromoScope): Promise<CardWorkflow | null> {
    const input = { ...scope };
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        input,
        this.policy.messagingConsentPolicyVersion,
      );
      return identity
        ? this.workflow(tx, identity.userId, identity.applicationId)
        : null;
    });
  }
  private async ownerAction(
    raw: ExpertCardEvent,
    operation: Operation,
    semantic: unknown,
    action: (
      tx: ExpertCardTransaction,
      draft: DraftRow,
    ) => Promise<void | ResidentSafetyAssessment>,
  ) {
    const event = normalizeCardEvent(raw);
    if (!this.work(event)) fail("card_forbidden");
    return this.tx(async (tx) => {
      const started = await beginCardRequest(tx, event, operation, semantic);
      if (
        !(await originalConsent(
          tx,
          started.userId,
          this.policy.messagingConsentPolicyVersion,
        ))
      )
        fail("card_forbidden");
      const app = await paidApplication(tx, started.userId);
      if (!app) return fail("card_forbidden");
      if (started.replay)
        return {
          ...(await this.workflow(tx, started.userId, app.applicationId)),
          replay: true,
          ...(await residentSafetyOutcome(
            tx,
            started.userId,
            `owner:${event.requestKey}`,
          )),
        };
      const draft = await this.ensureDraft(tx, started.userId, event);
      const assessment = await action(tx, draft);
      if (assessment)
        await recordResidentSafety(
          tx,
          draft,
          `owner:${event.requestKey}`,
          assessment,
        );
      await finishCardRequest(tx, started, draft.id);
      return {
        ...(await this.workflow(tx, started.userId, app.applicationId)),
        replay: false,
        ...(assessment
          ? {
              safetyBlocked: assessment.blocked,
              safetyIssues: assessment.issues,
            }
          : {}),
      };
    });
  }
  async readOwnedDocument<T>(
    scope: ExpertPromoScope & { reference: string },
    read: () => Promise<T>,
  ): Promise<T> {
    if (!this.work(scope)) return fail("card_forbidden");
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        scope,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const d = await this.draft(tx, identity.userId);
      if (!d || !["collecting", "changes_requested"].includes(d.status))
        return fail("card_state_conflict");
      const source = (
        await tx.execute(
          sql`select 1 from expert_card_entries where draft_id=${d.id}::uuid and kind='document' and media_reference=${scope.reference} limit 1`,
        )
      ).rows;
      if (!source.length) return fail("card_forbidden");
      return read();
    });
  }
  async ingestRichPhoto(
    raw: ExpertCardEvent & {
      expectedRevision: number;
      reference: string;
      size: number;
      mimeType: "image/jpeg" | "image/png";
    },
  ) {
    const event = normalizeCardEvent(raw);
    if (
      !this.work(event) ||
      !media(raw.reference) ||
      !Number.isSafeInteger(raw.size) ||
      raw.size < 1 ||
      raw.size > 20 * 1024 * 1024 ||
      !["image/jpeg", "image/png"].includes(raw.mimeType)
    )
      return fail("card_invalid_entry");
    const allocated = await this.tx(async (tx) => {
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const d = await this.ensureDraft(tx, identity.userId, event);
      if (
        d.revision !== raw.expectedRevision ||
        !["collecting", "changes_requested"].includes(d.status)
      )
        fail("card_revision_conflict");
      const entry = (
        await tx.execute(
          sql`select 1 from expert_card_entries where draft_id=${d.id}::uuid and revision=${raw.expectedRevision} and kind='photo' and media_reference=${raw.reference}`,
        )
      ).rows;
      if (entry.length !== 1) fail("card_forbidden");
      const rich = (
        await tx.execute<{ enabled: boolean }>(
          sql`select rich_mode as enabled from expert_card_drafts where id=${d.id}::uuid`,
        )
      ).rows[0]!;
      if (!rich.enabled) return { id: "", state: "legacy", fresh: false };
      const prior = (
        await tx.execute<{
          id: string;
          state: string;
          writeState: string;
          size: number;
          mimeType: string;
        }>(
          sql`select m.id,m.state,o.write_state as "writeState",m.size,m.mime_type as "mimeType" from resident_card_media m join resident_object_deletions o on o.custody_id=m.id and not o.erased where m.draft_id=${d.id}::uuid and m.source_reference=${raw.reference}`,
        )
      ).rows[0];
      if (prior) {
        if (prior.size !== raw.size || prior.mimeType !== raw.mimeType)
          fail("card_invalid_entry");
        if (prior.state === "verified" && prior.writeState === "settled") {
          const profile = (
            await tx.execute<{ profile: RichProfile }>(
              sql`select rich_profile as profile from expert_card_drafts where id=${d.id}::uuid`,
            )
          ).rows[0]!.profile;
          if (!profile.photos.some((p) => p.toLowerCase() === prior.id)) {
            const active = (
              await tx.execute<{ n: number }>(
                sql`select count(*)::int n from resident_card_media m where m.draft_id=${d.id}::uuid and (m.state<>'verified' or m.id=any(${"{" + profile.photos.join(",") + "}"}::uuid[]))`,
              )
            ).rows[0]!.n;
            if (active >= 10) fail("card_state_conflict");
            await tx.execute(
              sql`update expert_card_drafts set rich_profile=${JSON.stringify({ ...profile, photos: [...profile.photos, prior.id] })}::jsonb,revision=revision+1 where id=${d.id}::uuid`,
            );
          }
        }
        return {
          id: prior.id,
          state: prior.state,
          fresh:
            prior.state === "allocated" && prior.writeState === "allocated",
        };
      }
      // Only settled, unselected objects with no immutable approval reference may leave custody.
      await tx.execute(
        sql`delete from resident_card_media m using resident_object_deletions o,expert_card_drafts d where m.draft_id=${d.id}::uuid and d.id=m.draft_id and o.custody_id=m.id and o.write_state='settled' and m.state='verified' and not exists(select 1 from jsonb_array_elements_text(d.rich_profile->'photos') p where p::uuid=m.id) and not exists(select 1 from resident_card_versions v,jsonb_array_elements_text(v.profile->'photos') p where v.draft_id=d.id and p::uuid=m.id)`,
      );
      const count = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::integer n from resident_card_media m join expert_card_drafts d on d.id=m.draft_id where m.draft_id=${d.id}::uuid and (m.state<>'verified' or exists(select 1 from jsonb_array_elements_text(d.rich_profile->'photos') p where p::uuid=m.id))`,
        )
      ).rows[0]!.n;
      if (count >= 10) fail("card_state_conflict");
      const custodyId = randomUUID();
      await tx.execute(
        sql`insert into resident_object_deletions(custody_id,object_key,subject_erasure_key,write_state) values(${custodyId}::uuid,${"custody/" + custodyId},${privateObjectErasureSubjectKey(d.userId)},'allocated')`,
      );
      await tx.execute(
        sql`insert into resident_card_media(id,draft_id,source_reference,size,mime_type) values(${custodyId}::uuid,${d.id}::uuid,${raw.reference},${raw.size},${raw.mimeType})`,
      );
      return { id: custodyId, state: "allocated", fresh: true };
    });
    if (!allocated.fresh || !this.photoCustody)
      return {
        id: allocated.id,
        state:
          allocated.state === "legacy"
            ? ("legacy" as const)
            : allocated.state === "verified"
              ? ("verified" as const)
              : ("unavailable" as const),
      };
    // Persist the possible write before any network request. Failure never drops the deletion obligation.
    await this.tx(async (tx) => {
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) fail("card_forbidden");
      await tx.execute(
        sql`update resident_object_deletions set write_state='inflight',updated_at=clock_timestamp() where custody_id=${allocated.id}::uuid and not erased`,
      );
    });
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return { id: allocated.id, state: "unknown" as const };
      const d = await this.draft(tx, identity.userId);
      if (!d || d.revision !== raw.expectedRevision)
        return { id: allocated.id, state: "unknown" as const };
      const signal = AbortSignal.timeout(10000);
      let sha256: string | null = null;
      let verified = false;
      try {
        const bytes = await this.photoCustody!.read({
          botId: event.botId,
          fileId: raw.reference.slice(14),
          size: raw.size,
          mimeType: raw.mimeType,
          signal,
        });
        if (bytes && bytes.byteLength === raw.size) {
          sha256 = shaBytes(bytes);
          verified = await this.photoCustody!.put({
            key: "custody/" + allocated.id,
            custodyId: allocated.id,
            bytes,
            sha256,
            size: raw.size,
            mimeType: raw.mimeType,
            signal,
          });
        }
      } catch {
        /* Fail closed; no transport errors or private references in logs. */
      }
      await tx.execute(
        sql`update resident_object_deletions set write_state=${verified ? "settled" : "unknown"},updated_at=clock_timestamp() where custody_id=${allocated.id}::uuid`,
      );
      await tx.execute(
        sql`update resident_card_media set sha256=${sha256},state=${verified ? "verified" : "unknown"} where id=${allocated.id}::uuid`,
      );
      if (verified) {
        const p = (
          await tx.execute<{ profile: RichProfile }>(
            sql`select rich_profile as profile from expert_card_drafts where id=${d.id}::uuid`,
          )
        ).rows[0]!.profile;
        await tx.execute(
          sql`update expert_card_drafts set rich_profile=${JSON.stringify({ ...p, photos: [...new Set([...p.photos, allocated.id])] })}::jsonb,revision=revision+1 where id=${d.id}::uuid`,
        );
      }
      return {
        id: allocated.id,
        state: verified ? ("verified" as const) : ("unknown" as const),
      };
    });
  }
  async richMediaLink(
    sessionHash: string,
    applicationId: string,
    mediaId: string,
  ) {
    if (!this.photoCustody || !id.test(applicationId) || !id.test(mediaId))
      fail("card_forbidden");
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash);
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_card_drafts where application_id=${applicationId}::uuid`,
        )
      ).rows[0];
      if (!initial) return fail("card_forbidden");
      await lockClientConsentSubject(tx, initial.userId);
      if (
        !(await originalConsent(
          tx,
          initial.userId,
          this.policy.messagingConsentPolicyVersion,
        )) ||
        !(await paidApplication(tx, initial.userId))
      )
        return fail("card_forbidden");
      const o = (
        await tx.execute<{ sha256: string; size: number; mimeType: string }>(
          sql`select m.sha256,m.size,m.mime_type as "mimeType" from resident_card_media m join expert_card_drafts d on d.id=m.draft_id join resident_object_deletions o on o.custody_id=m.id and not o.erased and o.write_state='settled' where m.id=${mediaId}::uuid and d.application_id=${applicationId}::uuid and m.state='verified' for share of m,o`,
        )
      ).rows[0];
      if (!o) return fail("card_forbidden");
      const url = await this.photoCustody!.presign({
        ...o,
        key: "custody/" + mediaId,
        custodyId: mediaId,
      });
      await lockExpertManagerAuthority(tx, sessionHash);
      await tx.execute(
        sql`insert into resident_document_access_audit(custody_id,manager_id,action) values(${mediaId}::uuid,${managerId}::uuid,'link_issued')`,
      );
      return { url, expiresIn: 120, bearerUntilExpiry: true };
    });
  }

  async richAction(
    raw: ExpertCardEvent & {
      expectedRevision: number;
      action:
        | "patch"
        | "service"
        | "remove_service"
        | "remove_photo"
        | "propose"
        | "accept_proposal"
        | "preview"
        | "proposal_preview"
        | "confirm"
        | "start"
        | "geocode"
        | "manager"
        | "guided_answer"
        | "service_add";
      automaticRevision?: boolean;
      value?: unknown;
      page?: number;
      token?: string;
    },
  ): Promise<
    CardWorkflow & {
      replay: boolean;
      pageText?: string;
      safetyBlocked?: boolean;
      safetyIssues?: ResidentSafetyAssessment["issues"];
    }
  > {
    const event = normalizeCardEvent(raw);
    this.revision(raw.expectedRevision);
    if (!this.work(event)) fail("card_forbidden");
    return this.tx(async (tx) => {
      const started = await beginCardRequest(tx, event, "entry", {
        rich: raw.action,
        revision: raw.automaticRevision ? null : raw.expectedRevision,
        automaticRevision: raw.automaticRevision ?? false,
        value: raw.value ?? null,
        page: raw.page ?? null,
        token: raw.token ?? null,
      });
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const d = await this.ensureDraft(tx, identity.userId, event);
      if (started.replay)
        return {
          ...(await this.workflow(tx, d.userId, d.applicationId)),
          replay: true,
        };
      if (d.revision !== raw.expectedRevision) fail("card_revision_conflict");
      const row = (
        await tx.execute<{
          profile: RichProfile;
          guided: GuidedService;
          proposal: RichProposal | null;
          pending: GuidedService[];
          page: number | null;
          token: string | null;
          digest: string | null;
          currentDigest: string;
        }>(
          sql`select rich_profile as profile,rich_guided as guided,rich_pending_services as pending,rich_proposal as proposal,preview_page as page,preview_token_digest as token,preview_content_digest as digest,resident_rich_digest(expert_card_drafts) as "currentDigest" from expert_card_drafts where id=${d.id}::uuid`,
        )
      ).rows[0]!;
      let profile = row.profile ?? emptyRichProfile();
      let guided = row.guided;
      let pending = row.pending;
      const proposalFields = (proposal: RichProposal | null) => {
        const { partialServices, ...patch } = proposal ?? {};
        return {
          ...richSafetyFields(
            richProfileSchema.parse({ ...profile, ...patch }),
          ),
          ...Object.fromEntries(
            (partialServices ?? []).map((v, i) => [
              "rich:pending:" + i,
              JSON.stringify(v),
            ]),
          ),
        };
      };
      let pageText: string | undefined;
      if (row.profile === null && d.approvedReviewId)
        await tx.execute(
          sql`insert into resident_card_versions(review_id,draft_id,revision,profile,public_payload,safety_fields,safety_proof) select id,draft_id,revision,null,public_payload,resident_card_effective_fields(draft_id),safety_proof from expert_card_reviews where id=${d.approvedReviewId}::uuid on conflict do nothing`,
        );
      if (raw.action === "manager") {
        await tx.execute(
          sql`update expert_card_drafts set assistance_requested_at=case when assistance_requested_at is null or assistance_resolved_at is not null then clock_timestamp() else assistance_requested_at end,assistance_revision=case when assistance_requested_at is null or assistance_resolved_at is not null then revision else assistance_revision end,assistance_resolved_at=null where id=${d.id}::uuid`,
        );
        pageText =
          "Запрос помощи сохранён в защищённой очереди менеджера. Ожидает ответа; уведомление вне очереди не подтверждено.";
      } else if (
        raw.action === "preview" ||
        raw.action === "proposal_preview" ||
        raw.action === "confirm"
      ) {
        const isProposal = raw.action === "proposal_preview";
        const assessment = await assessResidentContent(
          tx,
          isProposal
            ? proposalFields(row.proposal)
            : {
                ...richSafetyFields(profile),
                ...Object.fromEntries(
                  pending.map((v, i) => [
                    "rich:pending:" + i,
                    JSON.stringify(v),
                  ]),
                ),
              },
          d.revision,
        );
        if (assessment.blocked) {
          await recordResidentSafety(
            tx,
            d,
            `owner:${event.requestKey}`,
            assessment,
          );
          await finishCardRequest(tx, started, d.id);
          return {
            ...(await this.workflow(tx, d.userId, d.applicationId)),
            replay: false,
            safetyBlocked: true,
            safetyIssues: assessment.issues,
          };
        }
        const pages = isProposal
          ? richReadablePages(row.proposal)
          : [
              ...richPreviewPages(profile, d.publicCard),
              ...(pending.length || Object.keys(guided).length
                ? richReadablePages({
                    partialServices: [
                      ...(Object.keys(guided).length ? [guided] : []),
                      ...pending,
                    ],
                  })
                : []),
              ...profile.photos.map((_, i) => `Фото ${i + 1}`),
            ];
        const textPageCount = isProposal
          ? pages.length
          : pages.length - profile.photos.length;
        const previewDigest =
          row.currentDigest + (isProposal ? ":proposal" : "");
        if (raw.action === "confirm") {
          if (
            row.page !== pages.length - 1 ||
            row.digest !== row.currentDigest ||
            !raw.token ||
            sha(raw.token) !== row.token
          )
            fail("card_preview_incomplete");
          if (Object.keys(guided).length || pending.length)
            throw new ExpertCardError(
              "card_fields:завершите услугу через /card_mode",
            );
          const gaps = richProfileGaps(profile);
          if (gaps.length)
            throw new ExpertCardError("card_fields:" + gaps.join(","));
          await tx.execute(
            sql`update expert_card_drafts set owner_confirmed_digest=resident_rich_digest(expert_card_drafts) where id=${d.id}::uuid`,
          );
          pageText = `Версия подтверждена. /card_submit ${d.revision}`;
        } else {
          const page = raw.page ?? 0;
          if (
            !Number.isInteger(page) ||
            page < 0 ||
            page >= pages.length ||
            (page > 0 &&
              (row.page !== page - 1 ||
                row.digest !== previewDigest ||
                !raw.token ||
                sha(raw.token) !== row.token))
          )
            fail("card_preview_incomplete");
          let displayed = pages[page]!;
          if (!isProposal && page >= textPageCount) {
            const mediaId = profile.photos[page - textPageCount]!;
            const object = (
              await tx.execute<{
                sha256: string;
                size: number;
                mimeType: string;
              }>(
                sql`select m.sha256,m.size,m.mime_type as "mimeType" from resident_card_media m join resident_object_deletions o on o.custody_id=m.id and not o.erased and o.write_state='settled' where m.id=${mediaId}::uuid and m.draft_id=${d.id}::uuid and m.state='verified' for share of m,o`,
              )
            ).rows[0];
            if (!object || !this.photoCustody)
              throw new ExpertCardError(
                "card_fields:просмотр фото временно недоступен; попробуйте позднее",
              );
            const link = await this.photoCustody.presign({
              ...object,
              key: "custody/" + mediaId,
              custodyId: mediaId,
            });
            displayed += `
Убрать это фото из черновика: /card_photo_remove ${d.revision} ${page - textPageCount + 1}
Для замены сначала уберите фото, затем пришлите новое. Утверждённая версия сохранится до проверки.
 — откройте и проверьте изображение. Закрытая ссылка действует 2 минуты, не пересылайте её:\n${link}`;
          }
          const token = randomUUID();
          await tx.execute(
            sql`update expert_card_drafts set preview_page=${page},preview_token_digest=${sha(token)},preview_content_digest=${previewDigest} where id=${d.id}::uuid`,
          );
          pageText = `Ревизия ${d.revision}. Страница ${page + 1}/${pages.length}\n${displayed}\n${page + 1 < pages.length ? `/${isProposal ? "card_proposal" : "card_preview"} ${d.revision} ${page + 1} ${token}` : `/${isProposal ? "card_accept" : "card_confirm"} ${d.revision} ${token}`}`;
        }
      } else {
        if (d.status === "manager_review") fail("card_state_conflict");
        if (raw.action === "geocode") {
          const found = await this.geocode?.(
            profile.address,
            AbortSignal.timeout(5000),
          );
          if (found?.kind === "located")
            await tx.execute(
              sql`update expert_card_drafts set rich_proposal=${JSON.stringify({ yandexMapsUrl: found.url })}::jsonb,revision=revision+1,status='collecting',approved_review_id=null where id=${d.id}::uuid`,
            );
          pageText =
            found?.kind === "located"
              ? `Проверьте предложенную карту: /card_proposal ${d.revision + 1}`
              : "Геокодирование недоступно или адрес неоднозначен. Адрес сохранён. Исправьте адрес или задайте ссылку Яндекс.Карт вручную через /card_set.";
        } else if (raw.action === "propose") {
          const patch = richProposalSchema.parse(raw.value);
          const assessment = await assessResidentContent(
            tx,
            proposalFields(patch),
            d.revision + 1,
          );
          if (assessment.blocked) {
            await recordResidentSafety(
              tx,
              d,
              `owner:${event.requestKey}`,
              assessment,
            );
            await finishCardRequest(tx, started, d.id);
            return {
              ...(await this.workflow(tx, d.userId, d.applicationId)),
              replay: false,
              safetyBlocked: true,
              safetyIssues: assessment.issues,
            };
          }
          await tx.execute(
            sql`update expert_card_drafts set rich_proposal=${JSON.stringify(patch)}::jsonb,revision=revision+1,status='collecting',approved_review_id=null where id=${d.id}::uuid`,
          );
          pageText = `Предложение сохранено, ещё не применено. Полный просмотр: /card_proposal ${d.revision + 1}`;
          // Larger proposals are inspected with the same lossless page flow before acceptance.
          if (pageText.length > 3900)
            pageText = `Предложение сохранено. Откройте /card_proposal ${d.revision + 1} для полного просмотра.`;
        } else {
          if (raw.action === "service_add") {
            if (profile.services.length + pending.length >= 8)
              throw new ExpertCardError("card_fields:не более восьми услуг");
            if (!Object.keys(guided).length) guided = { id: randomUUID() };
          }
          if (raw.action === "guided_answer") {
            try {
              const r = guidedRichAnswer(
                profile,
                guided,
                String(raw.value ?? ""),
                randomUUID,
              );
              profile = r.profile;
              guided = r.staged;
              if (!Object.keys(guided).length && pending.length)
                guided = pending.shift()!;
            } catch (error) {
              throw new ExpertCardError(
                "card_fields:" +
                  (error instanceof Error ? error.message : "Проверьте ответ"),
              );
            }
          }
          if (raw.action === "patch")
            profile = richProfileSchema.parse({
              ...profile,
              ...richProfilePatchSchema.parse(raw.value),
            });
          if (raw.action === "service") {
            const s = richServiceSchema.parse(raw.value);
            profile = richProfileSchema.parse({
              ...profile,
              services: [...profile.services.filter((x) => x.id !== s.id), s],
            });
          }
          if (raw.action === "remove_service")
            profile = richProfileSchema.parse({
              ...profile,
              services: profile.services.filter(
                (s) => s.id !== String(raw.value).toLowerCase(),
              ),
            });
          if (raw.action === "remove_photo") {
            const index = Number(raw.value) - 1;
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= profile.photos.length
            )
              fail("card_invalid_entry");
            profile = {
              ...profile,
              photos: profile.photos.filter((_, i) => i !== index),
            };
          }
          if (raw.action === "accept_proposal") {
            const pages = richReadablePages(row.proposal);
            if (
              !row.proposal ||
              row.page !== pages.length - 1 ||
              row.digest !== row.currentDigest + ":proposal" ||
              !raw.token ||
              sha(raw.token) !== row.token
            )
              fail("card_preview_incomplete");
            const { partialServices = [], ...patch } = richProposalSchema.parse(
              row.proposal,
            );
            profile = richProfileSchema.parse({
              ...profile,
              ...patch,
              services: [...profile.services, ...(patch.services ?? [])].filter(
                (v, i, a) => a.findIndex((x) => x.id === v.id) === i,
              ),
            });
            pending = [...pending, ...partialServices];
            if (
              profile.services.length +
                pending.length +
                (Object.keys(guided).length ? 1 : 0) >
              8
            )
              throw new ExpertCardError("card_fields:не более восьми услуг");
            if (!Object.keys(guided).length && pending.length)
              guided = pending.shift()!;
          }
          const fields = await residentSafetyFields(tx, d.id);
          for (const key of Object.keys(fields))
            if (key.startsWith("rich:")) delete fields[key];
          Object.assign(fields, richSafetyFields(profile), {
            "rich:guided": JSON.stringify(guided),
            ...Object.fromEntries(
              pending.map((v, i) => ["rich:pending:" + i, JSON.stringify(v)]),
            ),
          });
          const assessment = await assessResidentContent(
            tx,
            fields,
            d.revision + 1,
          );
          if (assessment.blocked) {
            await recordResidentSafety(
              tx,
              d,
              `owner:${event.requestKey}`,
              assessment,
            );
            await finishCardRequest(tx, started, d.id);
            return {
              ...(await this.workflow(tx, d.userId, d.applicationId)),
              replay: false,
              safetyBlocked: true,
              safetyIssues: assessment.issues,
            };
          }
          await tx.execute(
            sql`update expert_card_drafts set rich_mode=true,rich_profile=${JSON.stringify(profile)}::jsonb,rich_guided=${JSON.stringify(guided)}::jsonb,rich_pending_services=${JSON.stringify(pending)}::jsonb,rich_proposal=null,revision=revision+1,status='collecting',approved_review_id=null,updated_at=clock_timestamp() where id=${d.id}::uuid`,
          );
          const gaps = richProfileGaps(profile);
          pageText = `Сохранено. Ревизия ${d.revision + 1}. ${guidedRichQuestion(profile, guided)}`;
          void gaps;
        }
      }
      await finishCardRequest(tx, started, d.id);
      return {
        ...(await this.workflow(tx, d.userId, d.applicationId)),
        replay: false,
        ...(pageText ? { pageText } : {}),
      };
    });
  }

  async addEntry(
    raw: ExpertCardEvent & { expectedRevision: number; entry: CardEntry },
  ) {
    const event = normalizeCardEvent(raw);
    const entry = decodeCardEntry(raw.entry);
    const expected = raw.expectedRevision;
    this.revision(expected);
    return this.ownerAction(event, "entry", { entry }, async (tx, draft) => {
      if (draft.revision !== expected) fail("card_revision_conflict");
      if (!["collecting", "changes_requested"].includes(draft.status))
        fail("card_state_conflict");
      const count = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int n from expert_card_entries where draft_id=${draft.id}::uuid`,
        )
      ).rows[0]!.n;
      const rich = (
        await tx.execute<{ enabled: boolean }>(
          sql`select rich_mode as enabled from expert_card_drafts where id=${draft.id}::uuid`,
        )
      ).rows[0]?.enabled;
      if (count >= (rich ? 80 : 100)) fail("card_state_conflict");
      const fields = await residentSafetyFields(tx, draft.id);
      delete fields.document_proposal;
      for (const key of Object.keys(fields))
        if (key.startsWith("public:")) delete fields[key];
      if (entry.kind === "text") fields["entry:new"] = entry.text;
      const assessment = await assessResidentContent(
        tx,
        fields,
        draft.revision + 1,
      );
      if (assessment.blocked) return assessment;
      await tx.execute(
        sql`insert into expert_card_entries(draft_id,user_id,revision,kind,text_content,media_reference) values(${draft.id}::uuid,${draft.userId}::uuid,${draft.revision + 1},${entry.kind},${entry.kind === "text" ? entry.text : null},${entry.kind === "text" ? null : entry.reference})`,
      );
      await tx.execute(
        sql`update expert_card_drafts set revision=revision+1,status='collecting',input_mode='INTERVIEW',document_proposal=null,document_import_revision=null,rich_proposal=case when rich_mode then ${
          entry.kind === "text"
            ? JSON.stringify(
                proposeRichFields(entry.text, (i) => {
                  const h = sha(event.requestDigest + ":" + i);
                  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
                }),
              )
            : null
        }::jsonb else null end,public_payload=null,approved_review_id=null,messaging_policy_version=${this.policy.messagingConsentPolicyVersion},updated_at=clock_timestamp() where id=${draft.id}::uuid`,
      );
      await this.invalidateJobs(tx, draft.id);
      return assessment;
    });
  }
  async readOwnAnswers(scope: ExpertPromoScope) {
    if (!this.work(scope)) fail("card_forbidden");
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        scope,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const draft = await this.ensureDraft(tx, identity.userId, scope);
      return {
        revision: draft.revision,
        fields: await residentSafetyFields(tx, draft.id),
      };
    });
  }
  async correctEntry(
    raw: ExpertCardEvent & {
      expectedRevision: number;
      entryId: string;
      text: string;
    },
  ) {
    const entry = decodeCardEntry({ kind: "text", text: raw.text });
    if (entry.kind !== "text" || !id.test(raw.entryId))
      return fail("card_invalid_entry");
    this.revision(raw.expectedRevision);
    return this.ownerAction(
      raw,
      "entry",
      {
        correction: raw.entryId,
        text: entry.text,
        revision: raw.expectedRevision,
      },
      async (tx, draft) => {
        if (draft.revision !== raw.expectedRevision)
          fail("card_revision_conflict");
        if (!["collecting", "changes_requested"].includes(draft.status))
          fail("card_state_conflict");
        const fields = await residentSafetyFields(tx, draft.id);
        if (!(`entry:${raw.entryId}` in fields)) fail("card_invalid_entry");
        fields[`entry:${raw.entryId}`] = entry.text;
        delete fields.document_proposal;
        for (const key of Object.keys(fields))
          if (key.startsWith("public:")) delete fields[key];
        // Permit incremental repair of other legacy blocked fields: the replacement
        // itself must pass; submission will reassess all effective fields together.
        const assessment = await assessResidentContent(
          tx,
          { [`entry:${raw.entryId}`]: entry.text },
          draft.revision + 1,
        );
        if (assessment.blocked) return assessment;
        await tx.execute(
          sql`insert into resident_card_corrections(draft_id,user_id,entry_id,revision,text_content) values(${draft.id}::uuid,${draft.userId}::uuid,${raw.entryId}::uuid,${draft.revision + 1},${entry.text})`,
        );
        await tx.execute(
          sql`update expert_card_drafts set revision=revision+1,status='collecting',input_mode='INTERVIEW',document_proposal=null,document_import_revision=null,public_payload=null,approved_review_id=null,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
        );
        await this.invalidateJobs(tx, draft.id);
        return assessment;
      },
    );
  }
  async changeDocumentProposal(
    raw: ExpertCardEvent & {
      expectedRevision: number;
      replacement: string | null;
    },
  ) {
    this.revision(raw.expectedRevision);
    if (
      raw.replacement !== null &&
      (typeof raw.replacement !== "string" ||
        raw.replacement.trim().length < 50 ||
        Buffer.byteLength(raw.replacement) > 64000)
    )
      fail("card_invalid_entry");
    return this.ownerAction(
      raw,
      "entry",
      { documentProposal: raw.replacement, revision: raw.expectedRevision },
      async (tx, draft) => {
        if (draft.revision !== raw.expectedRevision)
          fail("card_revision_conflict");
        if (!["collecting", "changes_requested"].includes(draft.status))
          fail("card_state_conflict");
        const current = (
          await tx.execute<{
            proposal: { source: "pdf" | "docx"; content: string } | null;
          }>(
            sql`select document_proposal as proposal from expert_card_drafts where id=${draft.id}::uuid`,
          )
        ).rows[0]!.proposal;
        if (!current) return fail("card_state_conflict");
        const proposal =
          raw.replacement === null
            ? null
            : { source: current.source, content: raw.replacement };
        const assessment = await assessResidentContent(
          tx,
          proposal ? { document_proposal: proposal.content } : {},
          draft.revision + 1,
        );
        if (assessment.blocked) return assessment;
        await tx.execute(
          sql`insert into resident_card_proposal_changes(draft_id,user_id,revision,previous_proposal,replacement_proposal) values(${draft.id}::uuid,${draft.userId}::uuid,${draft.revision + 1},${JSON.stringify(current)}::jsonb,${proposal ? JSON.stringify(proposal) : null}::jsonb)`,
        );
        await tx.execute(
          sql`update expert_card_drafts set revision=revision+1,status='collecting',input_mode=${proposal ? "DOCUMENT_PROPOSAL" : "INTERVIEW"},document_proposal=${proposal ? JSON.stringify(proposal) : null}::jsonb,document_import_revision=${proposal ? draft.revision + 1 : null},public_payload=null,approved_review_id=null,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
        );
        await this.invalidateJobs(tx, draft.id);
        return assessment;
      },
    );
  }
  async completeDocumentImport(
    raw: ExpertCardEvent & {
      expectedRevision: number;
      proposal: { source: "pdf" | "docx"; content: string } | null;
    },
  ) {
    const event = normalizeCardEvent(raw);
    const expected = raw.expectedRevision;
    this.revision(expected);
    const proposal = raw.proposal ? { ...raw.proposal } : null;
    if (
      proposal &&
      (!["pdf", "docx"].includes(proposal.source) ||
        typeof proposal.content !== "string" ||
        proposal.content.trim().length < 50 ||
        Buffer.byteLength(proposal.content) > 64000 ||
        Buffer.byteLength(JSON.stringify(proposal)) > 90000)
    )
      fail("card_invalid_entry");
    if (!this.work(event)) fail("card_forbidden");
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return false;
      const draft = await this.draft(tx, identity.userId);
      if (
        !draft ||
        draft.revision !== expected ||
        !["collecting", "changes_requested"].includes(draft.status) ||
        draft.botId !== event.botId ||
        draft.botKey !== event.botKey ||
        draft.chatId !== event.chatId
      )
        return false;
      const original = (
        await tx.execute(
          sql`select 1 from expert_card_requests r join expert_card_entries e on e.draft_id=r.result_id and e.user_id=r.user_id and e.revision=${expected} and e.kind='document' where r.bot_id=${event.botId} and r.update_id=${event.updateId} and r.request_digest=${event.requestDigest} and r.user_id=${identity.userId}::uuid and r.operation='entry'`,
        )
      ).rows;
      if (original.length !== 1) return false;
      const previous = (
        await tx.execute<{ revision: number | null; proposal: unknown }>(
          sql`select document_import_revision as revision,document_proposal as proposal from expert_card_drafts where id=${draft.id}::uuid`,
        )
      ).rows[0]!;
      if (previous.revision !== null) {
        const outcome = await residentSafetyOutcome(
          tx,
          draft.userId,
          `import:${event.requestKey}`,
        );
        if (outcome.safetyBlocked) return "manual_fallback" as const;
        return (
          previous.revision === expected &&
          canonical(previous.proposal) === canonical(proposal)
        );
      }
      const fields = await residentSafetyFields(tx, draft.id);
      if (proposal) fields.document_proposal = proposal.content;
      const assessment = await assessResidentContent(
        tx,
        fields,
        draft.revision,
      );
      await recordResidentSafety(
        tx,
        draft,
        `import:${event.requestKey}`,
        assessment,
      );
      const accepted = assessment.blocked ? null : proposal;
      await tx.execute(
        sql`update expert_card_drafts set document_import_revision=${expected},input_mode=${accepted ? "DOCUMENT_PROPOSAL" : "INTERVIEW"},document_proposal=${accepted ? JSON.stringify(accepted) : null}::jsonb,rich_proposal=case when rich_mode then ${
          accepted
            ? JSON.stringify(
                proposeRichFields(accepted.content, (i) => {
                  const h = sha(event.requestDigest + ":" + i);
                  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
                }),
              )
            : null
        }::jsonb else null end,owner_confirmed_digest=null,preview_page=null,preview_token_digest=null,preview_content_digest=null,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
      );
      return assessment.blocked ? ("manual_fallback" as const) : true;
    });
  }
  async getDraftTags(scope: ExpertPromoScope, page = 0) {
    if (!this.work(scope) || !Number.isInteger(page) || page < 0 || page > 100)
      fail("card_invalid_tags");
    return this.tx(async (tx) => {
      const identity = await owner(
        tx,
        scope,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const draft = await this.ensureDraft(tx, identity.userId, scope);
      if (!["collecting", "changes_requested"].includes(draft.status))
        fail("card_state_conflict");
      const visible = sql`h.is_active or exists(select 1 from expert_card_draft_tags t where t.draft_id=${draft.id}::uuid and t.tag_id=h.id)`;
      const total = (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int n from hashtags_db h where ${visible}`,
        )
      ).rows[0]!.n;
      const pages = Math.max(1, Math.ceil(total / 8)),
        actualPage = Math.min(page, pages - 1);
      const tags = (
        await tx.execute<{
          id: string;
          label: string;
          selected: boolean;
          active: boolean;
        }>(
          sql`select h.id,h.display_label as label,h.is_active as active,exists(select 1 from expert_card_draft_tags t where t.draft_id=${draft.id}::uuid and t.tag_id=h.id) as selected from hashtags_db h where ${visible} order by h.parent_category,h.sub_category,h.tag_value,h.id limit 8 offset ${actualPage * 8}`,
        )
      ).rows;
      const labels = (
        await tx.execute<{ label: string }>(
          sql`select h.display_label as label from expert_card_draft_tags t join hashtags_db h on h.id=t.tag_id where t.draft_id=${draft.id}::uuid order by h.display_label`,
        )
      ).rows.map((r) => r.label);
      return {
        revision: draft.revision,
        page: actualPage,
        pages,
        tags,
        tags_array: labels,
      };
    });
  }
  async toggleDraftTag(
    raw: ExpertCardEvent & { expectedRevision: number; tagId: string },
  ) {
    const expected = raw.expectedRevision,
      tagId = raw.tagId;
    this.revision(expected);
    if (!id.test(tagId)) fail("card_invalid_tags");
    return this.ownerAction(
      raw,
      "tags_toggle",
      { revision: expected, tagId },
      async (tx, draft) => {
        if (draft.revision !== expected) fail("card_revision_conflict");
        if (!["collecting", "changes_requested"].includes(draft.status))
          fail("card_state_conflict");
        const tag = (
          await tx.execute(
            sql`select id,is_active from hashtags_db where id=${tagId}::uuid for share`,
          )
        ).rows;
        if (tag.length !== 1) fail("card_invalid_tags");
        const fields = await residentSafetyFields(tx, draft.id);
        const selectedBefore = `tag:${tagId}` in fields;
        if (selectedBefore) delete fields[`tag:${tagId}`];
        else {
          const value = (
            await tx.execute<{ value: string }>(
              sql`select tag_value||' '||display_label as value from hashtags_db where id=${tagId}::uuid`,
            )
          ).rows[0]!.value;
          fields[`tag:${tagId}`] = value;
        }
        for (const key of Object.keys(fields))
          if (key.startsWith("public:")) delete fields[key];
        const assessment = await assessResidentContent(
          tx,
          selectedBefore ? {} : fields,
          draft.revision + 1,
        );
        if (assessment.blocked) return assessment;
        const selected = (
          await tx.execute(
            sql`delete from expert_card_draft_tags where draft_id=${draft.id}::uuid and tag_id=${tagId}::uuid returning tag_id`,
          )
        ).rows;
        if (!selected.length && tag[0]?.is_active !== true)
          fail("card_invalid_tags");
        if (!selected.length)
          await tx.execute(
            sql`insert into expert_card_draft_tags(draft_id,user_id,tag_id) values(${draft.id}::uuid,${draft.userId}::uuid,${tagId}::uuid)`,
          );
        await tx.execute(
          sql`update expert_card_drafts set revision=revision+1,public_payload=null,approved_review_id=null,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
        );
        await this.invalidateJobs(tx, draft.id);
        return assessment;
      },
    );
  }
  async submitDraft(raw: ExpertCardEvent & { expectedRevision: number }) {
    const event = normalizeCardEvent(raw);
    const expected = raw.expectedRevision;
    this.revision(expected);
    return this.ownerAction(
      event,
      "submit",
      { revision: expected },
      async (tx, draft) => {
        if (draft.revision !== expected) fail("card_revision_conflict");
        if (!["collecting", "changes_requested"].includes(draft.status))
          fail("card_state_conflict");
        const count = (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int n from expert_card_entries where draft_id=${draft.id}::uuid`,
          )
        ).rows[0]!.n;
        const rich = (
          await tx.execute<{
            rich: boolean;
            profile: RichProfile;
            confirmed: boolean;
          }>(
            sql`select rich_mode as rich,rich_profile as profile,owner_confirmed_digest=resident_rich_digest(expert_card_drafts) as confirmed from expert_card_drafts where id=${draft.id}::uuid`,
          )
        ).rows[0]!;
        if (rich.rich) {
          const gaps = richProfileGaps(rich.profile);
          if (gaps.length)
            throw new ExpertCardError("card_fields:" + gaps.join(","));
          if (!rich.confirmed) fail("card_preview_incomplete");
        } else if (count < 1) fail("card_state_conflict");
        const assessment = await assessResidentContent(
          tx,
          await residentSafetyFields(tx, draft.id),
          draft.revision,
        );
        if (assessment.blocked) return assessment;
        await tx.execute(
          sql`update expert_card_drafts set status='manager_review',updated_at=clock_timestamp() where id=${draft.id}::uuid`,
        );
        await tx.execute(
          sql`update expert_onboarding_applications set onboarding_stage='manager_review',updated_at=clock_timestamp() where id=${draft.applicationId}::uuid`,
        );
        return assessment;
      },
    );
  }
  async submitPromoProof(
    raw: ExpertCardEvent & { expectedRevision: number; proof: CardPromoProof },
  ) {
    const event = normalizeCardEvent(raw),
      proof = decodeCardPromoProof(raw.proof);
    const expectedRevision = raw.expectedRevision;
    this.revision(expectedRevision);
    return this.tx(async (tx) => {
      const started = await beginCardRequest(tx, event, "promo_proof", {
        proof,
        revision: expectedRevision,
      });
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const draft = await this.draft(tx, identity.userId);
      if ((draft?.revision ?? 0) !== expectedRevision)
        return fail("card_revision_conflict");
      if (!started.replay) {
        const n = (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int n from expert_application_promo_proofs where application_id=${identity.applicationId}::uuid`,
          )
        ).rows[0]!.n;
        if (n >= 50) return fail("card_state_conflict");
        await tx.execute(
          sql`insert into expert_application_promo_proofs(application_id,user_id,kind,reference) values(${identity.applicationId}::uuid,${identity.userId}::uuid,${proof.kind},${proof.reference})`,
        );
        await finishCardRequest(tx, started, identity.applicationId);
      }
      return {
        ...(await this.workflow(tx, identity.userId, identity.applicationId)),
        replay: started.replay,
      };
    });
  }
  private async invalidateJobs(tx: ExpertCardTransaction, draftId: string) {
    await tx.execute(
      sql`update expert_card_material_jobs set status='cancelled' where draft_id=${draftId}::uuid and status in ('waiting_content','pending') and attempt_id is null`,
    );
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where draft_id=${draftId}::uuid and active=true and not exists(select 1 from resident_card_versions v where v.review_id=experts_published.review_id)`,
    );
  }
  async listDrafts(sessionHash: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      fail("card_invalid_event");
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const identities = (
        await tx.execute<{ userId: string; applicationId: string }>(
          sql`select d.user_id as "userId",d.application_id as "applicationId" from expert_card_drafts d join users u on u.id=d.user_id and u.active=true order by (d.assistance_requested_at is not null and d.assistance_resolved_at is null) desc,d.updated_at,d.id limit ${limit}`,
        )
      ).rows;
      const result: CardWorkflow[] = [];
      for (const row of identities) {
        const summary = await this.workflow(tx, row.userId, row.applicationId);
        if (summary.draftId !== null) result.push(summary);
      }
      return result;
    });
  }
  async readDraft(sessionHash: string, applicationId: string) {
    if (!id.test(applicationId)) fail("card_invalid_event");
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_card_drafts where application_id=${applicationId}::uuid`,
        )
      ).rows[0];
      if (!initial) return null;
      await lockClientConsentSubject(tx, initial.userId);
      await lockExpertManagerAuthority(tx, sessionHash);
      if (
        !(await originalConsent(
          tx,
          initial.userId,
          this.policy.messagingConsentPolicyVersion,
        )) ||
        !(await paidApplication(tx, initial.userId))
      )
        return null;
      const draft = await this.draft(tx, initial.userId);
      if (!draft) return null;
      const entries = (
        await tx.execute<{
          id: string;
          kind: CardEntry["kind"];
          text: string | null;
          reference: string | null;
          revision: number;
        }>(
          sql`select id,kind,text_content as text,media_reference as reference,revision from expert_card_entries where draft_id=${draft.id}::uuid order by revision,id limit 100`,
        )
      ).rows;
      const materials =
        (
          await tx.execute<{
            jobId: string;
            status: string;
            contentVersion: string | null;
          }>(
            sql`select id as "jobId",status,content_version as "contentVersion" from expert_card_material_jobs where draft_id=${draft.id}::uuid order by created_at desc,id desc limit 1`,
          )
        ).rows[0] ?? null;
      const promoProofs = (
        await tx.execute<{
          id: string;
          kind: CardPromoProof["kind"];
          reference: string;
          revision: number;
          reviewId: string;
        }>(
          sql`select id,kind,reference,0::int as revision,null::uuid as "reviewId" from expert_application_promo_proofs where application_id=${draft.applicationId}::uuid order by created_at,id limit 50`,
        )
      ).rows;
      return {
        ...(await this.workflow(tx, draft.userId, draft.applicationId)),
        entries,
        assistance: (
          await tx.execute(
            sql`select assistance_requested_at as "requestedAt",assistance_revision as revision,assistance_resolved_at as "resolvedAt" from expert_card_drafts where id=${draft.id}::uuid`,
          )
        ).rows[0],
        rich: (
          await tx.execute<{
            enabled: boolean;
            profile: RichProfile | null;
            proposal: RichProposal | null;
            pending: GuidedService[];
            guided: GuidedService;
            confirmed: boolean | null;
          }>(
            sql`select rich_mode as enabled,rich_profile as profile,rich_guided as guided,rich_pending_services as pending,rich_proposal as proposal,owner_confirmed_digest=resident_rich_digest(expert_card_drafts) as confirmed from expert_card_drafts where id=${draft.id}::uuid`,
          )
        ).rows[0],
        previousVersion:
          (
            await tx.execute(
              sql`select profile,public_payload as "publicCard",revision from resident_card_versions where draft_id=${draft.id}::uuid order by revision desc limit 1`,
            )
          ).rows[0] ?? null,
        media: (
          await tx.execute(
            sql`select id,state from resident_card_media where draft_id=${draft.id}::uuid order by id limit 10`,
          )
        ).rows,
        returnReason:
          (
            await tx.execute<{ reason: string }>(
              sql`select return_reason as reason from expert_card_reviews where draft_id=${draft.id}::uuid and action='return_changes' order by created_at desc limit 1`,
            )
          ).rows[0]?.reason ?? null,
        effectiveFields: await residentSafetyFields(tx, draft.id),
        safety: await assessResidentContent(
          tx,
          await residentSafetyFields(tx, draft.id),
          draft.revision,
        ),
        publicCard: draft.publicCard,
        approvedReviewId: draft.approvedReviewId,
        materials:
          materials ??
          (
            await tx.execute<{
              jobId: string;
              status: string;
              contentVersion: string | null;
            }>(
              sql`select id as "jobId",status,content_version as "contentVersion" from expert_application_material_jobs where application_id=${draft.applicationId}::uuid and (status='delivered' or attempt_id is not null) limit 1`,
            )
          ).rows[0] ??
          null,
        promoProofs,
      };
    });
  }
  private async staffAction(
    input: StaffCommand,
    operation: "edit_public" | "approve" | "return_changes" | "confirm_promo",
    payload: unknown,
    action: (
      tx: ExpertCardTransaction,
      draft: DraftRow,
      managerId: string,
    ) => Promise<string | undefined | ResidentSafetyAssessment>,
  ) {
    this.revision(input.expectedRevision);
    if (
      !id.test(input.applicationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.idempotencyKey)
    )
      fail("card_invalid_event");
    const semantic = sha(
      canonical({
        operation,
        applicationId: input.applicationId,
        revision: input.expectedRevision,
        payload,
      }),
    );
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, input.sessionHash);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`card-staff:${managerId}:${input.idempotencyKey}`},0))`,
      );
      const initial = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_card_drafts where application_id=${input.applicationId}::uuid`,
        )
      ).rows[0];
      if (!initial) return fail("card_state_conflict");
      await lockClientConsentSubject(tx, initial.userId);
      await lockExpertManagerAuthority(tx, input.sessionHash);
      if (
        !(await originalConsent(
          tx,
          initial.userId,
          this.policy.messagingConsentPolicyVersion,
        )) ||
        !(await paidApplication(tx, initial.userId))
      )
        fail("card_forbidden");
      const draft = await this.draft(tx, initial.userId);
      if (!draft) return fail("card_state_conflict");
      const prior = (
        await tx.execute<{
          draftId: string;
          operation: string;
          semantic: string;
          resultId: string | null;
        }>(
          sql`select draft_id as "draftId",operation,semantic_digest as semantic,result_id as "resultId" from expert_card_staff_actions where manager_id=${managerId}::uuid and idempotency_key=${input.idempotencyKey}`,
        )
      ).rows[0];
      if (prior) {
        if (
          prior.draftId !== draft.id ||
          prior.operation !== operation ||
          prior.semantic !== semantic
        )
          fail("card_idempotency_conflict");
        return {
          ...(await this.workflow(tx, draft.userId, draft.applicationId)),
          ...(prior.resultId ? { reviewId: prior.resultId } : {}),
          ...(await residentSafetyOutcome(
            tx,
            draft.userId,
            `staff:${managerId}:${input.idempotencyKey}`,
          )),
          replay: true,
        };
      }
      if (draft.revision !== input.expectedRevision)
        fail("card_revision_conflict");
      const actionResult = await action(tx, draft, managerId);
      const assessment =
        typeof actionResult === "object" ? actionResult : undefined;
      const resultId =
        typeof actionResult === "string" ? actionResult : undefined;
      if (assessment)
        await recordResidentSafety(
          tx,
          draft,
          `staff:${managerId}:${input.idempotencyKey}`,
          assessment,
        );
      await tx.execute(
        sql`insert into expert_card_staff_actions(manager_id,idempotency_key,draft_id,operation,semantic_digest,result_id) values(${managerId}::uuid,${input.idempotencyKey},${draft.id}::uuid,${operation},${semantic},${resultId ?? null}::uuid)`,
      );
      await tx.execute(
        sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('admin',${managerId}::uuid,${input.sessionHash},${`expert_card.${operation}`},'expert_card_draft',${draft.id}::uuid,${assessment?.blocked ? "rejected" : "applied"},'card_review',${`card:${semantic}`},clock_timestamp(),${semantic})`,
      );
      return {
        ...(await this.workflow(tx, draft.userId, draft.applicationId)),
        ...(resultId ? { reviewId: resultId } : {}),
        ...(assessment
          ? {
              safetyBlocked: assessment.blocked,
              safetyIssues: assessment.issues,
            }
          : {}),
        replay: false,
      };
    });
  }
  async editPublicCard(raw: StaffCommand & { publicCard: ProfessionalCard }) {
    const input = { ...raw };
    const publicCard = decodeProfessionalCard(raw.publicCard);
    return this.staffAction(
      input,
      "edit_public",
      publicCard,
      async (tx, draft) => {
        if (
          !["manager_review", "changes_requested", "approved"].includes(
            draft.status,
          ) &&
          !(
            draft.status === "collecting" &&
            (
              await tx.execute<{ rich: boolean }>(
                sql`select rich_mode as rich from expert_card_drafts where id=${draft.id}::uuid`,
              )
            ).rows[0]?.rich
          )
        )
          fail("card_state_conflict");
        const fields = await residentSafetyFields(tx, draft.id);
        for (const [key, value] of Object.entries(publicCard))
          fields[`public:${key}`] = value;
        const assessment = await assessResidentContent(
          tx,
          fields,
          draft.revision + 1,
        );
        if (assessment.blocked) return assessment;
        await tx.execute(
          sql`update expert_card_drafts set public_payload=${JSON.stringify(publicCard)}::jsonb,revision=revision+1,status=case when rich_mode then 'collecting' else 'manager_review' end,approved_review_id=null,messaging_policy_version=${this.policy.messagingConsentPolicyVersion},updated_at=clock_timestamp() where id=${draft.id}::uuid`,
        );
        await this.invalidateJobs(tx, draft.id);
        return assessment;
      },
    );
  }
  async reviewCard(
    raw: StaffCommand & {
      action: "approve" | "return_changes";
      warningAcknowledgment?: string;
      returnReason?: string;
    },
  ) {
    const input = { ...raw };
    if (input.action !== "approve" && input.action !== "return_changes")
      fail("card_invalid_event");
    if (
      input.warningAcknowledgment !== undefined &&
      (typeof input.warningAcknowledgment !== "string" ||
        !/^[0-9a-f]{64}$/u.test(input.warningAcknowledgment))
    )
      fail("card_invalid_event");
    return this.staffAction(
      input,
      input.action,
      {
        warningAcknowledgment: input.warningAcknowledgment ?? null,
        returnReason: input.returnReason ?? null,
      },
      async (tx, draft, managerId) => {
        if (
          !["manager_review", "approved"].includes(draft.status) ||
          (input.action === "approve" &&
            (draft.status !== "manager_review" || !draft.publicCard))
        )
          fail("card_state_conflict");
        if (draft.publicCard) decodeProfessionalCard(draft.publicCard);
        if (input.action === "approve") {
          const assessment = await assessResidentContent(
            tx,
            await residentSafetyFields(tx, draft.id),
            draft.revision,
          );
          if (
            assessment.blocked ||
            (assessment.issues.length &&
              input.warningAcknowledgment !== assessment.digest)
          )
            return { ...assessment, blocked: true };
          await recordResidentSafety(
            tx,
            draft,
            `staff:${managerId}:${input.idempotencyKey}`,
            assessment,
          );
        }
        const review = (
          await tx.execute<{ id: string }>(
            sql`insert into expert_card_reviews(draft_id,user_id,revision,action,public_payload,public_digest,manager_id,manager_session_hash,warning_acknowledgment,return_reason) values(${draft.id}::uuid,${draft.userId}::uuid,${draft.revision},${input.action},${input.action === "approve" ? JSON.stringify(draft.publicCard) : null}::jsonb,${input.action === "approve" ? sql`'sha256:'||encode(digest(${JSON.stringify(draft.publicCard)}::jsonb::text,'sha256'),'hex')` : sql`null`},${managerId}::uuid,${input.sessionHash},${input.warningAcknowledgment ?? null},${input.returnReason ?? null}) returning id`,
          )
        ).rows[0]!;
        if (input.action === "approve") {
          await tx.execute(
            sql`update expert_card_drafts set status='approved',approved_review_id=${review.id}::uuid,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
          );
          await tx.execute(
            sql`update experts_published p set review_id=${review.id}::uuid,revision=${draft.revision},public_payload=r.public_payload,public_digest=r.public_digest,updated_at=clock_timestamp() from expert_card_reviews r join resident_card_versions v on v.review_id=r.id where r.id=${review.id}::uuid and p.draft_id=${draft.id}::uuid and p.active and exists(select 1 from expert_residency_current_coverage(p.expert_id) c where c.source_order_id=p.paid_order_id and c.ends_at=p.next_billing_date) and exists(select 1 from experts e where e.id=p.expert_id and e.active and e.verified) and not exists(select 1 from expert_referral_abuse_holds where expert_id=p.expert_id and status='open') and not exists(select 1 from expert_residency_lifecycle where expert_id=p.expert_id and status='paused')`,
          );
          await tx.execute(
            sql`update experts_published p set active=false,updated_at=clock_timestamp() where p.draft_id=${draft.id}::uuid and p.active and (not exists(select 1 from expert_residency_current_coverage(p.expert_id)) or exists(select 1 from expert_residency_lifecycle where expert_id=p.expert_id and status='paused') or exists(select 1 from expert_referral_abuse_holds where expert_id=p.expert_id and status='open'))`,
          );
          await tx.execute(
            sql`update experts e set active=false,updated_at=clock_timestamp() from experts_published p where p.expert_id=e.id and p.draft_id=${draft.id}::uuid and not p.active and (not exists(select 1 from expert_residency_current_coverage(e.id)) or exists(select 1 from expert_residency_lifecycle where expert_id=e.id and status='paused') or exists(select 1 from expert_referral_abuse_holds where expert_id=e.id and status='open'))`,
          );
          await tx.execute(
            sql`update experts e set public_display_name=p.public_payload->>'displayName',updated_at=clock_timestamp() from experts_published p where p.expert_id=e.id and p.draft_id=${draft.id}::uuid and p.review_id=${review.id}::uuid and p.active`,
          );
          await tx.execute(
            sql`insert into expert_card_material_jobs(draft_id,user_id,review_id,revision,target_bot_id,target_chat_id) select ${draft.id}::uuid,${draft.userId}::uuid,${review.id}::uuid,${draft.revision},${draft.botId},${draft.chatId} where not exists(select 1 from expert_application_material_jobs where application_id=${draft.applicationId}::uuid and (status='delivered' or attempt_id is not null)) and not exists(select 1 from experts_published where draft_id=${draft.id}::uuid) and not exists(select 1 from expert_card_material_jobs where draft_id=${draft.id}::uuid and status='unknown_outcome')`,
          );
          await tx.execute(
            sql`update expert_application_material_jobs g set status='cancelled' where g.application_id=${draft.applicationId}::uuid and g.attempt_id is null and g.status in ('waiting_content','pending') and exists(select 1 from expert_card_material_jobs j where j.draft_id=${draft.id}::uuid and j.review_id=${review.id}::uuid)`,
          );
          await tx.execute(
            sql`update expert_onboarding_applications set onboarding_stage='promo_check',updated_at=clock_timestamp() where id=${draft.applicationId}::uuid and not exists(select 1 from experts_published where draft_id=${draft.id}::uuid)`,
          );
        } else {
          await tx.execute(
            sql`update expert_card_drafts set status='changes_requested',approved_review_id=null,updated_at=clock_timestamp() where id=${draft.id}::uuid`,
          );
          await this.invalidateJobs(tx, draft.id);
        }
        await tx.execute(
          sql`update expert_card_drafts set assistance_resolved_at=clock_timestamp() where id=${draft.id}::uuid and assistance_requested_at is not null and assistance_resolved_at is null`,
        );
        return review.id;
      },
    );
  }
  async confirmPromo(raw: StaffCommand) {
    const input = { ...raw };
    this.revision(input.expectedRevision);
    if (
      !id.test(input.applicationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.idempotencyKey)
    )
      return fail("card_invalid_event");
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, input.sessionHash);
      const app = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_onboarding_applications where id=${input.applicationId}::uuid`,
        )
      ).rows[0];
      if (!app) return fail("card_forbidden");
      await lockClientConsentSubject(tx, app.userId);
      await lockExpertManagerAuthority(tx, input.sessionHash);
      if (
        !(await originalConsent(
          tx,
          app.userId,
          this.policy.messagingConsentPolicyVersion,
        )) ||
        !(await paidApplication(tx, app.userId))
      )
        return fail("card_forbidden");
      const draft = await this.draft(tx, app.userId);
      if ((draft?.revision ?? 0) !== input.expectedRevision)
        return fail("card_revision_conflict");
      const richGate = (
        await tx.execute<{ ready: boolean }>(
          sql`select not d.rich_mode or exists(select 1 from expert_card_material_jobs j where j.review_id=d.approved_review_id and j.status='delivered') or exists(select 1 from expert_application_material_jobs j where j.application_id=d.application_id and j.status='delivered' and j.delivery_receipt is not null) or exists(select 1 from experts_published p where p.draft_id=d.id) as ready from expert_card_drafts d where d.user_id=${app.userId}::uuid`,
        )
      ).rows[0];
      if (richGate?.ready === false) fail("card_gate_unavailable");
      const proofs = (
        await tx.execute(
          sql`select id from expert_application_promo_proofs where application_id=${input.applicationId}::uuid and user_id=${app.userId}::uuid for share`,
        )
      ).rows;
      if (!proofs.length) return fail("card_gate_unavailable");
      const proofDigest = await applicationProofDigest(tx, input.applicationId);
      const prior = (
        await tx.execute<{ proofDigest: string; applicationId: string }>(
          sql`select proof_digest as "proofDigest",application_id as "applicationId" from expert_application_promo_confirmations where manager_id=${managerId}::uuid and idempotency_key=${input.idempotencyKey}`,
        )
      ).rows[0];
      if (
        prior &&
        (prior.applicationId !== input.applicationId ||
          prior.proofDigest !== proofDigest)
      )
        return fail("card_idempotency_conflict");
      if (!prior)
        await tx.execute(
          sql`insert into expert_application_promo_confirmations(application_id,user_id,proof_digest,manager_id,session_hash,idempotency_key) values(${input.applicationId}::uuid,${app.userId}::uuid,${proofDigest},${managerId}::uuid,${input.sessionHash},${input.idempotencyKey}) on conflict(application_id) do update set proof_digest=excluded.proof_digest,manager_id=excluded.manager_id,session_hash=excluded.session_hash,idempotency_key=excluded.idempotency_key,created_at=clock_timestamp()`,
        );
      if (!prior)
        await tx.execute(
          sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('admin',${managerId}::uuid,${input.sessionHash},'expert_card.confirm_promo','expert_onboarding_application',${input.applicationId}::uuid,'applied','application_proof',${`application-promo:${sha(input.idempotencyKey)}`},clock_timestamp(),${sha(proofDigest)})`,
        );
      if (draft?.status === "approved")
        await tx.execute(
          sql`update expert_onboarding_applications set onboarding_stage='payment_ready',updated_at=clock_timestamp() where id=${input.applicationId}::uuid`,
        );
      return {
        ...(await this.workflow(tx, app.userId, input.applicationId)),
        ...(draft?.approvedReviewId
          ? { reviewId: draft.approvedReviewId }
          : {}),
        replay: !!prior,
      };
    });
  }
  async issueWorkHandoff(raw: ExpertCardEvent) {
    const event = normalizeCardEvent(raw);
    return this.tx(async (tx) => {
      const started = await beginCardRequest(tx, event, "handoff_issue", {
        targetBotId: this.policy.workBotId,
      });
      if (started.replay) return { kind: "duplicate" as const };
      const identity = await owner(
        tx,
        event,
        this.policy.messagingConsentPolicyVersion,
      );
      if (!identity) return fail("card_forbidden");
      const row = await issueOwnedWorkHandoff(tx, {
        userId: identity.userId,
        applicationId: identity.applicationId,
        sourceBotKey: event.botKey,
        externalId: event.telegramUserId,
        targetBotId: this.policy.workBotId,
        targetBotKey: this.policy.workBotKey,
      });
      await finishCardRequest(tx, started, identity.applicationId);
      return {
        kind: "issued" as const,
        token: row.token,
        expiresAt: row.expiresAt,
      };
    });
  }
  async redeemWorkHandoff(raw: ExpertCardEvent & { token: string }) {
    const event = normalizeCardEvent(raw);
    const token = raw.token;
    if (
      !this.work(event) ||
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(token)
    )
      fail("card_handoff_unavailable");
    const tokenDigest = `sha256:${sha(token)}`;
    const semanticDigest = sha(canonical({ tokenDigest }));
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`card:${event.botId}:${event.updateId}`},0))`,
      );
      const receipt = (
        await tx.execute<{
          userId: string | null;
          operation: string;
          requestDigest: string;
          semanticDigest: string;
          resultId: string | null;
        }>(
          sql`select user_id as "userId",operation,request_digest as "requestDigest",semantic_digest as "semanticDigest",result_id as "resultId" from expert_card_requests where bot_id=${event.botId} and update_id=${event.updateId}`,
        )
      ).rows[0];
      if (receipt) {
        if (
          !receipt.userId ||
          receipt.operation !== "handoff_redeem" ||
          receipt.requestDigest !== event.requestDigest ||
          receipt.semanticDigest !== semanticDigest
        )
          fail("card_idempotency_conflict");
        const identity = await owner(
          tx,
          event,
          this.policy.messagingConsentPolicyVersion,
        );
        if (!identity || identity.userId !== receipt.userId)
          return fail("card_forbidden");
        return {
          kind: "duplicate" as const,
          applicationId: identity.applicationId,
          userId: identity.userId,
        };
      }
      const candidate = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_card_handoffs where token_digest=${tokenDigest}`,
        )
      ).rows[0];
      if (!candidate) return fail("card_handoff_unavailable");
      await lockClientConsentSubject(tx, candidate.userId);
      const row = (
        await tx.execute<{
          userId: string;
          applicationId: string;
          sourceBotKey: string;
          externalId: string;
          botId: string;
          botKey: string;
          consumed: boolean;
        }>(
          sql`select user_id as "userId",application_id as "applicationId",source_bot_key as "sourceBotKey",external_id as "externalId",target_bot_id as "botId",target_bot_key as "botKey",consumed_at is not null as consumed from expert_card_handoffs where token_digest=${tokenDigest} for update`,
        )
      ).rows[0];
      const valid = (
        await tx.execute<{ valid: boolean }>(
          sql`select expires_at>clock_timestamp() as valid from expert_card_handoffs where token_digest=${tokenDigest}`,
        )
      ).rows[0]?.valid;
      if (
        !row ||
        row.consumed ||
        valid !== true ||
        row.botId !== event.botId ||
        row.botKey !== event.botKey ||
        row.externalId !== event.telegramUserId
      )
        return fail("card_handoff_unavailable");
      const source = await owner(
        tx,
        {
          botKey: row.sourceBotKey,
          botId: event.botId,
          telegramUserId: row.externalId,
          chatId: row.externalId,
        },
        this.policy.messagingConsentPolicyVersion,
      );
      if (
        !source ||
        source.userId !== row.userId ||
        source.applicationId !== row.applicationId
      )
        return fail("card_forbidden");
      const target = (
        await tx.execute<{ userId: string; status: string }>(
          sql`select user_id as "userId",status from channel_identities where provider='telegram' and bot_key=${event.botKey} and external_id=${event.telegramUserId} and external_chat_id=${event.chatId} order by id limit 2 for update`,
        )
      ).rows;
      if (
        target.length > 1 ||
        (target[0] &&
          (target[0].userId !== row.userId || target[0].status !== "active"))
      )
        return fail("card_forbidden");
      if (!target.length)
        await tx.execute(
          sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${row.userId}::uuid,'telegram',${event.telegramUserId},${event.botKey},${event.chatId},'active')`,
        );
      await tx.execute(
        sql`update expert_card_handoffs set consumed_at=clock_timestamp() where token_digest=${tokenDigest}`,
      );
      await tx.execute(
        sql`update expert_application_material_jobs set target_bot_id=${event.botId},target_bot_key=${event.botKey},target_chat_id=${event.chatId} where application_id=${row.applicationId}::uuid and user_id=${row.userId}::uuid and target_bot_id is null and attempt_id is null`,
      );
      const started = await startKnownRequest(
        tx,
        event,
        row.userId,
        "handoff_redeem",
        semanticDigest,
      );
      await finishCardRequest(tx, started, row.applicationId);
      return {
        kind: "linked" as const,
        applicationId: row.applicationId,
        userId: row.userId,
      };
    });
  }
  async listDueMaterialJobs(limit = 25): Promise<readonly { jobId: string }[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      fail("card_invalid_event");
    const applicationJobs = await new PostgresExpertApplicationMaterials(
      this.db,
      this.policy.messagingConsentPolicyVersion,
      this.transport,
    ).listDue(limit);
    const legacyJobs = await this.tx(
      async (tx) =>
        (
          await tx.execute<{ jobId: string; createdAt: string | Date }>(
            sql`select j.id as "jobId",j.created_at as "createdAt" from expert_card_material_jobs j join expert_card_drafts d on d.id=j.draft_id and d.approved_review_id=j.review_id and d.revision=j.revision and d.status='approved' join users u on u.id=j.user_id and u.active=true where j.status in ('waiting_content','pending') and j.attempt_id is null
 and d.work_bot_id=${this.policy.workBotId} and d.work_bot_key=${this.policy.workBotKey}
 and d.messaging_policy_version=${this.policy.messagingConsentPolicyVersion} and expert_card_current_messaging_authority(d.user_id,d.messaging_policy_version)
 and (select count(*) from channel_identities ci where ci.user_id=d.user_id and ci.provider='telegram' and ci.bot_key=d.work_bot_key and ci.external_id=d.work_chat_id and ci.external_chat_id=d.work_chat_id and ci.status='active')=1
 and exists(select 1 from expert_onboarding_applications a join expert_onboarding_invoices i on i.application_id=a.id and i.user_id=a.user_id and i.status='settled' join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.admission='interview' where a.id=d.application_id and a.user_id=d.user_id and a.verification_status='approved' and a.archived_at is null and a.archive_until_date is null)
 and exists(select 1 from expert_card_material_templates t where t.status='approved') order by j.created_at,j.id limit ${limit}`,
          )
        ).rows,
    );
    return [...applicationJobs, ...legacyJobs]
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.jobId.localeCompare(b.jobId),
      )
      .slice(0, limit)
      .map(({ jobId }) => ({ jobId }));
  }
  private async materialJob(tx: ExpertCardTransaction, jobId: string) {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from expert_card_material_jobs where id=${jobId}::uuid`,
      )
    ).rows[0];
    if (!initial) return null;
    await lockClientConsentSubject(tx, initial.userId);
    const row = (
      await tx.execute<{
        id: string;
        userId: string;
        draftId: string;
        reviewId: string;
        revision: number;
        status: string;
        attemptId: string | null;
        contentVersion: string | null;
        templateId: string | null;
        botId: string;
        botKey: string;
        chatId: string;
        publicCard: ProfessionalCard;
        payloadDigest: string | null;
        policy: string;
      }>(
        sql`select j.id,j.user_id as "userId",j.draft_id as "draftId",j.review_id as "reviewId",j.revision,j.status,j.attempt_id as "attemptId",j.content_version as "contentVersion",j.template_id as "templateId",d.work_bot_id as "botId",d.work_bot_key as "botKey",d.work_chat_id as "chatId",r.public_payload as "publicCard",j.payload_digest as "payloadDigest",d.messaging_policy_version as policy from expert_card_material_jobs j join expert_card_drafts d on d.id=j.draft_id and d.user_id=j.user_id and d.approved_review_id=j.review_id and d.revision=j.revision and d.status='approved' join expert_card_reviews r on r.id=j.review_id and r.draft_id=d.id and r.revision=d.revision and r.action='approve' join users u on u.id=j.user_id and u.active=true where j.id=${jobId}::uuid and j.target_bot_id=d.work_bot_id and j.target_chat_id=d.work_chat_id and not exists(select 1 from expert_application_material_jobs g where g.application_id=d.application_id and (g.attempt_id is not null or g.status='delivered')) for update of j,d for share of r,u`,
      )
    ).rows[0];
    if (
      !row ||
      row.botId !== this.policy.workBotId ||
      row.botKey !== this.policy.workBotKey ||
      row.policy !== this.policy.messagingConsentPolicyVersion ||
      !(await paidApplication(tx, row.userId))
    )
      return null;
    const identity = await owner(
      tx,
      {
        botKey: row.botKey,
        botId: row.botId,
        telegramUserId: row.chatId,
        chatId: row.chatId,
      },
      this.policy.messagingConsentPolicyVersion,
    );
    return identity && identity.userId === row.userId ? row : null;
  }
  private materialPayload(
    template: { text: string; assets: unknown },
    publicCard: ProfessionalCard,
  ): ExpertCardMaterialPayload {
    const card = decodeProfessionalCard(publicCard);
    if (
      typeof template.text !== "string" ||
      !Array.isArray(template.assets) ||
      template.assets.length > 8
    )
      fail("card_content_unavailable");
    const text = template.text.replace(
      /\{\{\s*(displayName|profession|city|summary)\s*\}\}/gu,
      (_match, key: keyof ProfessionalCard) => card[key],
    );
    if (
      !text.trim() ||
      text.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text) ||
      /\{\{|\}\}/u.test(text)
    )
      fail("card_content_unavailable");
    const rawAssets = template.assets;
    if (!Array.isArray(rawAssets)) return fail("card_content_unavailable");
    const assets = rawAssets.map((value: unknown) => {
      const asset = decodeCardEntry(value);
      if (asset.kind === "text") return fail("card_content_unavailable");
      return { kind: asset.kind, reference: asset.reference };
    });
    return { text, assets };
  }
  async deliverMaterials(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<{
    kind:
      | "delivered"
      | "already_delivered"
      | "waiting_content"
      | "unknown_outcome"
      | "cancelled"
      | "unavailable";
  }> {
    if (!id.test(jobId)) fail("card_invalid_event");
    const applicationJob =
      (
        await this.db.execute(
          sql`select id from expert_application_material_jobs where id=${jobId}::uuid`,
        )
      ).rows.length > 0;
    if (applicationJob)
      return new PostgresExpertApplicationMaterials(
        this.db,
        this.policy.messagingConsentPolicyVersion,
        this.transport,
      ).deliver(jobId, options.signal);
    if (options.signal?.aborted) return { kind: "cancelled" };
    if (!this.transport) return { kind: "unavailable" };
    // A committed attempt is quarantine, NOT permission to disclose. Each actual
    // send below re-acquires current original consent and owns its barrier.
    const prepared = await this.tx(async (tx) => {
      const job = await this.materialJob(tx, jobId);
      if (!job) return { kind: "cancelled" as const };
      if (job.status === "delivered")
        return { kind: "already_delivered" as const };
      if (job.attemptId || job.status === "unknown_outcome")
        return { kind: "unknown_outcome" as const };
      if (job.status === "cancelled") return { kind: "cancelled" as const };
      const template = (
        await tx.execute<{
          id: string;
          version: string;
          text: string;
          assets: unknown;
        }>(
          sql`select id,content_version as version,text_body as text,assets from expert_card_material_templates where status='approved' order by created_at desc,id desc limit 1 for share`,
        )
      ).rows[0];
      if (!template) return { kind: "waiting_content" as const };
      const payload = this.materialPayload(template, job.publicCard);
      const payloadDigest = `sha256:${sha(JSON.stringify(payload))}`;
      const attemptId = randomUUID();
      await tx.execute(
        sql`update expert_card_material_jobs set template_id=${template.id}::uuid,content_version=${template.version},payload_digest=${payloadDigest},expected_message_count=${1 + payload.assets.length},attempt_id=${attemptId}::uuid,attempt_started_at=clock_timestamp(),status='unknown_outcome' where id=${jobId}::uuid`,
      );
      return {
        kind: "prepared" as const,
        attemptId,
        payload,
        payloadDigest,
        version: template.version,
      };
    });
    if (prepared.kind !== "prepared") return prepared;
    return this.tx(async (tx) => {
      const job = await this.materialJob(tx, jobId);
      if (!job) return { kind: "cancelled" as const };
      if (
        job.attemptId !== prepared.attemptId ||
        job.contentVersion !== prepared.version ||
        job.payloadDigest !== prepared.payloadDigest
      )
        return { kind: "unknown_outcome" as const };
      const selectedTemplate = (
        await tx.execute<{
          id: string;
          version: string;
          text: string;
          assets: unknown;
        }>(
          sql`select id,content_version as version,text_body as text,assets from expert_card_material_templates where id=${job.templateId}::uuid and content_version=${prepared.version} and status='approved' for share`,
        )
      ).rows[0];
      if (
        !selectedTemplate ||
        `sha256:${sha(JSON.stringify(this.materialPayload(selectedTemplate, job.publicCard)))}` !==
          prepared.payloadDigest
      )
        return { kind: "unknown_outcome" as const };
      if (options.signal?.aborted) return { kind: "unknown_outcome" as const };
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      try {
        const receipt = await this.transport!.send({
          botId: job.botId,
          botKey: job.botKey,
          userId: job.userId,
          chatId: job.chatId,
          reviewId: job.reviewId,
          revision: job.revision,
          contentVersion: prepared.version,
          payloadDigest: prepared.payloadDigest,
          payload: prepared.payload,
          signal,
        });
        if (
          signal.aborted ||
          receipt.botId !== job.botId ||
          receipt.chatId !== job.chatId ||
          receipt.contentVersion !== prepared.version ||
          receipt.payloadDigest !== prepared.payloadDigest ||
          !Array.isArray(receipt.messageIds) ||
          receipt.messageIds.length !== 1 + prepared.payload.assets.length ||
          new Set(receipt.messageIds).size !== receipt.messageIds.length ||
          receipt.messageIds.some(
            (value) =>
              typeof value !== "string" || !/^[1-9]\d{0,19}$/u.test(value),
          )
        )
          return { kind: "unknown_outcome" as const };
        const boundReceipt = {
          messageIds: [...receipt.messageIds],
          botId: receipt.botId,
          chatId: receipt.chatId,
          contentVersion: receipt.contentVersion,
          payloadDigest: receipt.payloadDigest,
        };
        await tx.execute(
          sql`update expert_card_material_jobs set status='delivered',delivery_receipt=${JSON.stringify(boundReceipt)}::jsonb,delivered_at=clock_timestamp() where id=${jobId}::uuid and attempt_id=${prepared.attemptId}::uuid`,
        );
        return { kind: "delivered" as const };
      } catch {
        return { kind: "unknown_outcome" as const };
      }
    });
  }
}
