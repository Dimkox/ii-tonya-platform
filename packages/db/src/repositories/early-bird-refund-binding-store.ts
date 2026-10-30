import { sql } from "drizzle-orm";
import {
  assertVerifiedEarlyBirdRefund,
  type YooKassaEarlyBirdRefundVerifier,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";
/** Default-off binder: issuer must perform fresh provider GETs in an isolated process. */
export class PostgresEarlyBirdRefundBindingStore {
  constructor(
    private readonly db: DrizzleDb,
    private readonly issuer: YooKassaEarlyBirdRefundVerifier,
    private readonly expectedLogin: string,
  ) {
    if (
      typeof expectedLogin !== "string" ||
      !/^[a-z][a-z0-9_]{0,62}$/u.test(expectedLogin)
    )
      throw new Error("early_bird_refund_binder_principal_invalid");
  }
  async bind(value: unknown): Promise<void> {
    assertVerifiedEarlyBirdRefund(value, this.issuer);
    const snapshot = JSON.stringify({
      invoiceId: value.invoiceId,
      userId: value.userId,
      operationId: value.operationId,
      refundOperationId: value.refundOperationId,
      paymentId: value.paymentId,
      refundId: value.refundId,
      pricingPolicy: value.pricingPolicy,
      priceKind: value.priceKind,
      mode: value.mode,
      grantId:
        value.pricingPolicy === "owner_test_10_20_v1" ? value.grantId : null,
      totalMinor: value.totalMinor,
    });
    await retryEarlyBirdSerialization(() =>
      this.db.transaction(
        async (tx) => {
          const principal = (
            await tx.execute<{ safe: boolean }>(
              sql`select current_user=session_user and session_user=${this.expectedLogin} and r.rolcanlogin and not capability.rolcanlogin and not capability.rolinherit and not capability.rolsuper and not capability.rolcreaterole and not capability.rolcreatedb and not capability.rolbypassrls and not capability.rolreplication and not pg_has_role(capability.oid,p.proowner,'MEMBER') and not has_function_privilege('public',p.oid,'EXECUTE') and exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and not membership.admin_option) and not exists(select 1 from pg_auth_members membership where membership.member=r.oid and membership.roleid=capability.oid and membership.admin_option) and not r.rolsuper and not r.rolcreaterole and not r.rolcreatedb and not r.rolbypassrls and not r.rolreplication and not pg_has_role(session_user,p.proowner,'MEMBER') and not has_database_privilege(session_user,current_database(),'CREATE') and not has_database_privilege(capability.oid,(select oid from pg_database where datname=current_database()),'CREATE') and not has_schema_privilege(session_user,'public','CREATE') and has_function_privilege(session_user,p.oid,'EXECUTE') and not exists(select 1 from pg_auth_members m join pg_roles granted on granted.oid=m.roleid where m.member=r.oid and granted.rolname<>'ii_tonya_wave_refund_binder') and not exists(select 1 from pg_auth_members m join pg_roles capability on capability.oid=m.member where capability.rolname='ii_tonya_wave_refund_binder') and not exists(select 1 from pg_proc other join pg_namespace ns on ns.oid=other.pronamespace join pg_language lang on lang.oid=other.prolang where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and other.oid<>p.oid and (other.prosecdef or (not lang.lanpltrusted and not exists(select 1 from pg_depend dep join pg_extension ext on ext.oid=dep.refobjid where dep.classid='pg_proc'::regclass and dep.objid=other.oid and dep.refclassid='pg_extension'::regclass and dep.deptype='e' and ext.extname in ('pgcrypto','btree_gist')))) and (has_function_privilege(session_user,other.oid,'EXECUTE') or has_function_privilege(capability.oid,other.oid,'EXECUTE'))) and not exists(select 1 from pg_namespace ns where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and (has_schema_privilege(session_user,ns.oid,'CREATE') or has_schema_privilege(capability.oid,ns.oid,'CREATE'))) and not exists(select 1 from pg_class protected join pg_namespace ns on ns.oid=protected.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and protected.relkind in ('r','p','v','m','f') and (pg_has_role(session_user,protected.relowner,'MEMBER') or pg_has_role(capability.oid,protected.relowner,'MEMBER') or has_table_privilege(session_user,protected.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege(capability.oid,protected.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(session_user,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege(capability.oid,protected.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) and not exists(select 1 from pg_class seq join pg_namespace ns on ns.oid=seq.relnamespace where left(ns.nspname,3)<>'pg_' and ns.nspname<>'information_schema' and seq.relkind='S' and (pg_has_role(session_user,seq.relowner,'MEMBER') or pg_has_role(capability.oid,seq.relowner,'MEMBER') or has_sequence_privilege(session_user,seq.oid,'SELECT,USAGE,UPDATE') or has_sequence_privilege(capability.oid,seq.oid,'SELECT,USAGE,UPDATE'))) as safe from pg_roles r join pg_roles capability on capability.rolname='ii_tonya_wave_refund_binder' join pg_proc p on p.oid='public.early_bird_bind_verified_refund(jsonb)'::regprocedure where r.rolname=session_user`,
            )
          ).rows[0];
          if (principal?.safe !== true)
            throw new Error("early_bird_refund_binder_principal_unsafe");
          await tx.execute(
            sql`select early_bird_bind_verified_refund(${snapshot}::jsonb)`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
}
