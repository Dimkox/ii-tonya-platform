-- Explicit operator action, never a migration or automatic application bootstrap.
-- The wrapper sets a transaction-local map derived from the fixed capability
-- catalogue. Existing LOGIN credentials are provisioned outside this SQL.
DO $$
DECLARE entries jsonb:=current_setting('ii_tonya.runtime_role_provision',true)::jsonb;
 item jsonb; signature text; capability text; login_name text; fn oid; schema_name text;
BEGIN
 IF entries IS NULL OR jsonb_typeof(entries)<>'array' OR jsonb_array_length(entries)=0 THEN RAISE EXCEPTION 'early_bird_role_mapping_missing'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
  capability:=item->>'capability'; login_name:=item->>'login';
  IF capability IS NULL OR login_name IS NULL OR jsonb_typeof(item->'functions') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'functions')=0
    OR capability !~ '^ii_tonya_(wave|deferred|worker)_[a-z_]+$' OR login_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR capability=login_name OR login_name=current_user
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=login_name AND rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'early_bird_role_login_unsafe'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=capability) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',capability);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=capability AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member WHERE member_role.rolname=capability)
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid WHERE member_role.rolname=login_name AND (granted.rolname<>capability OR m.admin_option))
  THEN RAISE EXCEPTION 'early_bird_role_membership_unsafe'; END IF;
  FOR signature IN SELECT jsonb_array_elements_text(item->'functions') LOOP
    IF signature !~ '^(public|early_bird_private)\.[a-z_]+\((uuid|text|integer|bigint|jsonb|timestamp with time zone)(,(uuid|text|integer|bigint|jsonb|timestamp with time zone))*\)$' THEN RAISE EXCEPTION 'early_bird_role_function_invalid'; END IF;
    fn:=to_regprocedure(signature);
    IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND prosecdef)
      OR has_function_privilege('public',fn,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND (pg_has_role(login_name,proowner,'MEMBER') OR pg_has_role(capability,proowner,'MEMBER')))
    THEN RAISE EXCEPTION 'early_bird_role_function_unsafe'; END IF;
  END LOOP;
  IF has_database_privilege(login_name,current_database(),'CREATE') OR has_database_privilege(capability,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace n WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND (has_schema_privilege(login_name,n.oid,'CREATE') OR has_schema_privilege(capability,n.oid,'CREATE')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f') AND (pg_has_role(login_name,c.relowner,'MEMBER') OR pg_has_role(capability,c.relowner,'MEMBER') OR has_table_privilege(login_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege(capability,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(login_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_any_column_privilege(capability,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND c.relkind='S' AND (pg_has_role(login_name,c.relowner,'MEMBER') OR pg_has_role(capability,c.relowner,'MEMBER') OR has_sequence_privilege(login_name,c.oid,'SELECT,USAGE,UPDATE') OR has_sequence_privilege(capability,c.oid,'SELECT,USAGE,UPDATE')))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language lang ON lang.oid=p.prolang WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND (p.prosecdef OR (NOT lang.lanpltrusted AND NOT EXISTS(SELECT 1 FROM pg_depend dep JOIN pg_extension ext ON ext.oid=dep.refobjid WHERE dep.classid='pg_proc'::regclass AND dep.objid=p.oid AND dep.refclassid='pg_extension'::regclass AND dep.deptype='e' AND ext.extname IN('pgcrypto','btree_gist')))) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'functions') allowed(signature) WHERE to_regprocedure(allowed.signature)=p.oid) AND (has_function_privilege(login_name,p.oid,'EXECUTE') OR has_function_privilege(capability,p.oid,'EXECUTE')))
  THEN RAISE EXCEPTION 'early_bird_role_extra_privilege' USING DETAIL=capability; END IF;
  FOR signature IN SELECT jsonb_array_elements_text(item->'functions') LOOP
    SELECT n.nspname INTO schema_name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(signature);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',schema_name,capability);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',signature,capability);
  END LOOP;
  EXECUTE format('GRANT %I TO %I',capability,login_name);
 END LOOP;
END $$;
