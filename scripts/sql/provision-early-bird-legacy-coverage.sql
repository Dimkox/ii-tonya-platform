-- Explicit operator provisioning; not a migration or feature activation.
-- Run as the function owner in a transaction after installing reviewed 0081/0082:
-- BEGIN;
-- SELECT set_config('ii_tonya.legacy_settlement_role','EXISTING_LOGIN',true);
-- [execute this file]
-- COMMIT;
-- Existing legacy table/lock privileges remain the operator's responsibility.
-- No binding, settlement, provider-verifier or direct wave-table rights are granted.
DO $$
DECLARE target_role text:=current_setting('ii_tonya.legacy_settlement_role',true);
BEGIN
 IF target_role IS NULL OR target_role='' OR NOT EXISTS(
   SELECT 1 FROM pg_roles WHERE rolname=target_role AND rolcanlogin
     AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolbypassrls
 ) THEN RAISE EXCEPTION 'early_bird_legacy_role_invalid'; END IF;
 IF to_regprocedure('public.early_bird_touch_coverage_epoch(uuid)') IS NULL
   OR to_regprocedure('public.early_bird_active_coverage_end(uuid)') IS NULL
   OR to_regclass('public.early_bird_payment_successes') IS NULL
 THEN RAISE EXCEPTION 'early_bird_legacy_coverage_unavailable'; END IF;
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.early_bird_touch_coverage_epoch(uuid), public.early_bird_active_coverage_end(uuid) TO %I',target_role);
END $$;
