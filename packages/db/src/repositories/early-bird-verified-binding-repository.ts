import { sql } from "drizzle-orm";
import {
  assertVerifiedEarlyBirdCandidate,
  type YooKassaEarlyBirdCandidateVerifier,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
/** Draft, inactive until connection provisioning and independent privilege review. */
export class PostgresEarlyBirdVerifiedBindingRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly verifier: YooKassaEarlyBirdCandidateVerifier,
    private readonly expectedLogin: string,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/u.test(expectedLogin))
      throw new Error("early_bird_binding_principal_invalid");
  }
  async bind(raw: unknown): Promise<void> {
    assertVerifiedEarlyBirdCandidate(raw, this.verifier);
    const standard = raw.pricingPolicy === "wave1_standard_v1";
    const snapshot = {
      invoiceId: raw.invoiceId,
      userId: raw.userId,
      operationId: raw.operationId,
      grantId: standard ? null : raw.grantId,
      pricingPolicy: raw.pricingPolicy,
      priceKind: raw.priceKind,
      mode: raw.mode,
      onboardingMinor: raw.onboardingMinor,
      subscriptionMinor: raw.subscriptionMinor,
      totalMinor: raw.totalMinor,
      baseOfferShownAt: new Date(raw.baseOfferShownAt).toISOString(),
      expiresAt: new Date(raw.expiresAt).toISOString(),
      launchAt: new Date(raw.launchAt).toISOString(),
      baseMonthlyMinor: standard ? raw.baseMonthlyMinor : null,
      ruleVersion: standard ? raw.ruleVersion : null,
      participantKind: standard ? raw.participantKind : null,
      promotionEligible: standard ? raw.promotionEligible : null,
      quotedAt: standard ? new Date(raw.quotedAt).toISOString() : null,
    };
    await this.db.transaction(async (tx) => {
      const principal = (
        await tx.execute<{ safe: boolean }>(
          sql`select current_user=session_user and session_user=${this.expectedLogin} and r.rolcanlogin and not capability.rolcanlogin and not capability.rolinherit and not capability.rolsuper and not capability.rolcreaterole and not capability.rolcreatedb and not capability.rolbypassrls and not capability.rolreplication and not pg_has_role(capability.oid,p.proowner,'MEMBER') and not has_function_privilege('public',p.oid,'EXECUTE') and exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and not membership.admin_option) and not exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and membership.admin_option) and not r.rolsuper and not r.rolcreaterole and not r.rolcreatedb and not r.rolbypassrls and not r.rolreplication and not pg_has_role(session_user,p.proowner,'MEMBER') and not has_database_privilege(session_user,current_database(),'CREATE') and not has_database_privilege(capability.oid,(select oid from pg_database where datname=current_database()),'CREATE') and not has_schema_privilege(session_user,'public','CREATE') and has_schema_privilege(session_user,'early_bird_private','USAGE') and not has_schema_privilege('public','early_bird_private','USAGE') and has_function_privilege(session_user,p.oid,'EXECUTE') and not exists(select 1 from pg_auth_members m join pg_roles granted on granted.oid=m.roleid where m.member=r.oid and granted.rolname<>'ii_tonya_wave_verifier') and not exists(select 1 from pg_auth_members m join pg_roles capability on capability.oid=m.member where capability.rolname='ii_tonya_wave_verifier') and not exists(select 1 from pg_proc other join pg_namespace ns on ns.oid=other.pronamespace join pg_language lang on lang.oid=other.prolang where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and other.oid<>p.oid and (other.prosecdef or (not lang.lanpltrusted and not exists(select 1 from pg_depend dep join pg_extension ext on ext.oid=dep.refobjid where dep.classid='pg_proc'::regclass and dep.objid=other.oid and dep.refclassid='pg_extension'::regclass and dep.deptype='e' and ext.extname in ('pgcrypto','btree_gist')))) and (has_function_privilege(session_user,other.oid,'EXECUTE') or has_function_privilege(capability.oid,other.oid,'EXECUTE'))) and not exists(select 1 from pg_namespace ns where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and (has_schema_privilege(session_user,ns.oid,'CREATE') or has_schema_privilege(capability.oid,ns.oid,'CREATE'))) and not exists(select 1 from pg_class protected join pg_namespace ns on ns.oid=protected.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and protected.relkind in ('r','p','v','m','f') and (pg_has_role(session_user,protected.relowner,'MEMBER') or pg_has_role(capability.oid,protected.relowner,'MEMBER') or has_table_privilege(session_user,protected.oid,CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN' ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END) or has_table_privilege(capability.oid,protected.oid,CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN' ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END) or has_any_column_privilege(session_user,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege(capability.oid,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) and not exists(select 1 from pg_class seq join pg_namespace ns on ns.oid=seq.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and seq.relkind='S' and (pg_has_role(session_user,seq.relowner,'MEMBER') or pg_has_role(capability.oid,seq.relowner,'MEMBER') or has_sequence_privilege(session_user,seq.oid,'SELECT,USAGE,UPDATE') or has_sequence_privilege(capability.oid,seq.oid,'SELECT,USAGE,UPDATE'))) as safe from pg_roles r join pg_roles capability on capability.rolname='ii_tonya_wave_verifier' join pg_proc p on p.oid='early_bird_private.bind_verified(uuid,uuid,text,text,jsonb)'::regprocedure where r.rolname=session_user`,
        )
      ).rows[0];
      if (principal?.safe !== true)
        throw new Error("early_bird_binding_principal_unsafe");
      await tx.execute(
        sql`select early_bird_private.bind_verified(${raw.operationId}::uuid,${raw.userId}::uuid,${raw.providerObjectId},${raw.evidenceDigest},${JSON.stringify(snapshot)}::jsonb)`,
      );
    });
  }
}
