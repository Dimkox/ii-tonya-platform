SELECT EXISTS (
 SELECT 1
 FROM pg_roles login_role, pg_roles cap,
      pg_proc claim_fn, pg_proc revoke_fn, pg_proc public_claim_fn
 WHERE login_role.rolname = session_user AND current_user = session_user
  AND cap.rolname = 'ii_tonya_wave_gateway'
  AND login_role.rolcanlogin AND NOT login_role.rolsuper AND NOT login_role.rolcreatedb AND NOT login_role.rolcreaterole AND NOT login_role.rolreplication AND NOT login_role.rolbypassrls
  AND NOT cap.rolcanlogin AND NOT cap.rolinherit AND NOT cap.rolsuper AND NOT cap.rolcreatedb AND NOT cap.rolcreaterole AND NOT cap.rolreplication AND NOT cap.rolbypassrls
  AND EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login_role.oid AND m.roleid=cap.oid AND NOT m.admin_option)
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login_role.oid AND m.roleid<>cap.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=cap.oid OR (m.roleid=cap.oid AND m.member<>login_role.oid))
  AND claim_fn.oid=to_regprocedure('public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)')
  AND revoke_fn.oid=to_regprocedure('public.early_bird_gateway_revoke(uuid)')
  AND public_claim_fn.oid=to_regprocedure('public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)')
  AND public_claim_fn.prosecdef AND public_claim_fn.proowner=claim_fn.proowner
  AND replace(array_to_string(public_claim_fn.proconfig,';'),' ','')='search_path=pg_catalog,public,pg_temp'
  AND NOT has_function_privilege('public',public_claim_fn.oid,'EXECUTE')
  AND has_function_privilege(login_role.oid,public_claim_fn.oid,'EXECUTE')
  AND claim_fn.prosecdef AND revoke_fn.prosecdef AND claim_fn.proowner=revoke_fn.proowner
  AND NOT pg_has_role(login_role.oid,claim_fn.proowner,'MEMBER') AND NOT pg_has_role(cap.oid,claim_fn.proowner,'MEMBER')
  AND replace(array_to_string(claim_fn.proconfig,';'),' ','')='search_path=pg_catalog,public,pg_temp'
  AND replace(array_to_string(revoke_fn.proconfig,';'),' ','')='search_path=pg_catalog,public,pg_temp'
  AND NOT has_function_privilege('public',claim_fn.oid,'EXECUTE') AND NOT has_function_privilege('public',revoke_fn.oid,'EXECUTE')
  AND has_function_privilege(login_role.oid,claim_fn.oid,'EXECUTE') AND has_function_privilege(login_role.oid,revoke_fn.oid,'EXECUTE')
  AND to_regclass('public.public_expert_payment_requests') IS NOT NULL
  AND to_regclass('public.public_expert_provider_identities') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname <> 'information_schema' AND c.relkind='S' AND (pg_has_role(login_role.oid,c.relowner,'MEMBER') OR pg_has_role(cap.oid,c.relowner,'MEMBER') OR has_sequence_privilege(login_role.oid,c.oid,'SELECT,USAGE,UPDATE') OR has_sequence_privilege(cap.oid,c.oid,'SELECT,USAGE,UPDATE')))
  AND to_regclass('public.receipt_revocation_outbox') IS NOT NULL
  AND to_regclass('public.early_bird_deferred_invoices') IS NOT NULL
  AND to_regclass('public.early_bird_deferred_accounts') IS NOT NULL
  AND to_regclass('public.early_bird_deferred_receipt_contacts') IS NOT NULL
  AND to_regclass('public.early_bird_deferred_requests') IS NOT NULL
  AND to_regclass('public.early_bird_gateway_claims') IS NOT NULL
  AND to_regclass('public.early_bird_gateway_contact_state') IS NOT NULL
  AND NOT has_database_privilege(login_role.oid,current_database(),'CREATE') AND NOT has_database_privilege(cap.oid,current_database(),'CREATE')
  AND NOT has_schema_privilege('public','public','CREATE')
  AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname <> 'information_schema' AND (has_schema_privilege(login_role.oid,n.oid,'CREATE') OR has_schema_privilege(cap.oid,n.oid,'CREATE')))
  AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f') AND (pg_has_role(login_role.oid,c.relowner,'MEMBER') OR pg_has_role(cap.oid,c.relowner,'MEMBER') OR has_table_privilege(login_role.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege(cap.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(login_role.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_any_column_privilege(cap.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname <> 'information_schema' AND p.oid NOT IN (claim_fn.oid,revoke_fn.oid,public_claim_fn.oid) AND p.prosecdef AND (has_function_privilege(login_role.oid,p.oid,'EXECUTE') OR has_function_privilege(cap.oid,p.oid,'EXECUTE')))
);
