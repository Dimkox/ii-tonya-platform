import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import type { StandardSnapshot } from "./early-bird-standard-snapshot-prepare.js";

export type EarlyBirdStandardAuthenticatedSnapshot = {
  intent: StandardSnapshot;
  sealed: { ciphertext: string; keyReference: string; digest: string };
};
export type EarlyBirdStandardSendAdmission =
  | { kind: "unavailable" }
  | { kind: "reconcile"; operationId: string }
  | {
      kind: "initial_send_admitted";
      userId: string;
      operationId: string;
      invoiceId: string;
      receiptContactId: string;
      idempotencyKey: string;
      digest: string;
      totalMinor: string;
      body: string;
    };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
type Row = {
  status: string;
  userId: string;
  operationId: string;
  invoiceId: string;
  priceKind: "discounted" | "full_price";
  eligible: boolean;
  participant: "expert" | "space";
  base: string;
  monthly: string;
  total: string;
  quote: string;
  idempotencyKey: string;
  digest: string;
  ciphertext: string | null;
  keyReference: string | null;
  offer: string;
  expiry: string;
  launch: string;
  contactAvailable: boolean;
};

/** Trusted sender repository; requires reviewed 0081+0087 triggers and protected DB credentials.
 * Commits unknown before any HTTP and never readmits an existing unknown operation.
 * It does not itself provide the network/deletion fence or authorize arbitrary callbacks.
 */
export class PostgresEarlyBirdStandardSendAdmission {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {
    if (
      typeof expectedLogin !== "string" ||
      !/^[a-z][a-z0-9_]{0,62}$/u.test(expectedLogin)
    )
      throw new Error("early_bird_send_principal_invalid");
  }
  async admit(
    input: { userId: string; operationId: string; receiptContactId: string },
    authenticate: (snapshot: EarlyBirdStandardAuthenticatedSnapshot) => string,
  ): Promise<EarlyBirdStandardSendAdmission> {
    if (
      ![input.userId, input.operationId, input.receiptContactId].every((id) =>
        uuid.test(id),
      )
    )
      throw new Error("early_bird_send_identity");
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      const principal = (
        await tx.execute<{ safe: boolean }>(
          sql`select current_user=session_user and session_user=${this.expectedLogin} and r.rolcanlogin and not capability.rolcanlogin and not capability.rolinherit and not capability.rolsuper and not capability.rolcreaterole and not capability.rolcreatedb and not capability.rolbypassrls and not capability.rolreplication and not pg_has_role(capability.oid,p.proowner,'MEMBER') and not has_function_privilege('public',p.oid,'EXECUTE') and exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and not membership.admin_option) and not exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and membership.admin_option) and not r.rolsuper and not r.rolcreaterole and not r.rolcreatedb and not r.rolbypassrls and not r.rolreplication and not pg_has_role(session_user,p.proowner,'MEMBER') and not has_database_privilege(session_user,current_database(),'CREATE') and not has_database_privilege(capability.oid,(select oid from pg_database where datname=current_database()),'CREATE') and not has_schema_privilege('public','public','CREATE') and not exists(select 1 from pg_roles untrusted cross join pg_namespace public_schema where public_schema.nspname='public' and not untrusted.rolsuper and not pg_has_role(untrusted.oid,public_schema.nspowner,'MEMBER') and has_schema_privilege(untrusted.oid,public_schema.oid,'CREATE')) and not has_schema_privilege(session_user,'public','CREATE') and has_schema_privilege(session_user,'early_bird_private','USAGE') and not has_schema_privilege('public','early_bird_private','USAGE') and p.prosecdef and replace(array_to_string(p.proconfig,';'),' ','')='search_path=pg_catalog,public,pg_temp' and exists(select 1 from pg_proc admission_fn where admission_fn.oid='early_bird_private.standard_admit_send(uuid,uuid,uuid,text)'::regprocedure and admission_fn.prosecdef and admission_fn.proowner=p.proowner and not pg_has_role(session_user,admission_fn.proowner,'MEMBER') and not pg_has_role(capability.oid,admission_fn.proowner,'MEMBER') and replace(array_to_string(admission_fn.proconfig,';'),' ','')='search_path=pg_catalog,public,pg_temp') and has_function_privilege(session_user,p.oid,'EXECUTE') and has_function_privilege(session_user,'early_bird_private.standard_admit_send(uuid,uuid,uuid,text)'::regprocedure,'EXECUTE') and not has_function_privilege('public','early_bird_private.standard_admit_send(uuid,uuid,uuid,text)'::regprocedure,'EXECUTE') and not exists(select 1 from pg_auth_members m join pg_roles granted on granted.oid=m.roleid where m.member=r.oid and granted.rolname<>'ii_tonya_wave_standard_sender') and not exists(select 1 from pg_auth_members m join pg_roles capability on capability.oid=m.member where capability.rolname='ii_tonya_wave_standard_sender') and not exists(select 1 from pg_proc other join pg_namespace ns on ns.oid=other.pronamespace join pg_language lang on lang.oid=other.prolang where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and other.oid not in(p.oid,'early_bird_private.standard_admit_send(uuid,uuid,uuid,text)'::regprocedure) and (other.prosecdef or (not lang.lanpltrusted and not exists(select 1 from pg_depend dep join pg_extension ext on ext.oid=dep.refobjid where dep.classid='pg_proc'::regclass and dep.objid=other.oid and dep.refclassid='pg_extension'::regclass and dep.deptype='e' and ext.extname in ('pgcrypto','btree_gist')))) and (has_function_privilege(session_user,other.oid,'EXECUTE') or has_function_privilege(capability.oid,other.oid,'EXECUTE'))) and not exists(select 1 from pg_namespace ns where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and (has_schema_privilege(session_user,ns.oid,'CREATE') or has_schema_privilege(capability.oid,ns.oid,'CREATE'))) and not exists(select 1 from pg_class protected join pg_namespace ns on ns.oid=protected.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and protected.relkind in ('r','p','v','m','f') and (pg_has_role(session_user,protected.relowner,'MEMBER') or pg_has_role(capability.oid,protected.relowner,'MEMBER') or has_table_privilege(session_user,protected.oid,CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN' ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END) or has_table_privilege(capability.oid,protected.oid,CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN' ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END) or has_any_column_privilege(session_user,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege(capability.oid,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) and not exists(select 1 from pg_class seq join pg_namespace ns on ns.oid=seq.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and seq.relkind='S' and (pg_has_role(session_user,seq.relowner,'MEMBER') or pg_has_role(capability.oid,seq.relowner,'MEMBER') or has_sequence_privilege(session_user,seq.oid,'SELECT,USAGE,UPDATE') or has_sequence_privilege(capability.oid,seq.oid,'SELECT,USAGE,UPDATE'))) as safe from pg_roles r join pg_roles capability on capability.rolname='ii_tonya_wave_standard_sender' join pg_proc p on p.oid='early_bird_private.standard_send_snapshot(uuid,uuid,uuid)'::regprocedure where r.rolname=session_user`,
        )
      ).rows[0];
      if (principal?.safe !== true)
        throw new Error("early_bird_send_principal_unsafe");
      const row = (
        await tx.execute<{ data: Row | null }>(
          sql`select early_bird_private.standard_send_snapshot(${input.userId}::uuid,${input.operationId}::uuid,${input.receiptContactId}::uuid) as data`,
        )
      ).rows[0]?.data;
      if (!row) return { kind: "unavailable" };
      if (
        row.status === "unknown" ||
        row.status === "settled" ||
        row.status === "refunded"
      )
        return { kind: "reconcile", operationId: row.operationId };
      if (
        row.status !== "prepared" ||
        row.contactAvailable !== true ||
        !row.ciphertext ||
        !row.keyReference
      )
        return { kind: "unavailable" };
      const body = authenticate({
        intent: {
          userId: row.userId,
          operationId: row.operationId,
          invoiceId: row.invoiceId,
          idempotencyKey: row.idempotencyKey,
          pricingPolicy: "wave1_standard_v1",
          ruleVersion: "expert_separated_sales_v3",
          priceKind: row.priceKind,
          promotionEligible: row.eligible,
          participantKind: row.participant,
          mode: "live",
          baseMonthlyMinor: row.base,
          onboardingMinor: "300000",
          subscriptionMinor: row.monthly,
          totalMinor: row.total,
          quotedAt: row.quote,
          baseOfferShownAt: row.offer,
          expiresAt: row.expiry,
          launchAt: row.launch,
        },
        sealed: {
          ciphertext: row.ciphertext,
          keyReference: row.keyReference,
          digest: row.digest,
        },
      });
      if (
        typeof body !== "string" ||
        Buffer.byteLength(body) > 32768 ||
        `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}` !==
          row.digest
      )
        throw new Error("early_bird_send_request_mismatch");
      // Mandatory SQL trigger repeats qualification, current consent, grant, choice,
      // phase and expiry after acquiring its own locks. No external I/O in this txn.
      const updated = await tx.execute<{ id: string | null }>(
        sql`select early_bird_private.standard_admit_send(${input.userId}::uuid,${input.operationId}::uuid,${input.receiptContactId}::uuid,${row.digest})::text as id`,
      );
      if (updated.rows[0]?.id !== row.operationId)
        throw new Error("early_bird_send_transition");
      return {
        kind: "initial_send_admitted",
        userId: row.userId,
        operationId: row.operationId,
        invoiceId: row.invoiceId,
        receiptContactId: input.receiptContactId,
        idempotencyKey: row.idempotencyKey,
        digest: row.digest,
        totalMinor: row.total,
        body,
      };
    });
  }
}
