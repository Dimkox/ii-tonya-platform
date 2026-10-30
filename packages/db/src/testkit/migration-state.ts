import type { DrizzleSnapshotJSON } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export interface ConstraintState {
  table_name: string;
  name: string;
  kind: string;
  definition: string;
  validated: boolean;
  deferrable: boolean;
  initially_deferred: boolean;
  columns_from: string[] | null;
  columns_to: string[] | null;
  expression: string | null;
}
export interface IndexState {
  table_name: string;
  name: string;
  definition: string;
  columns: { position: number; opclass: string }[];
}

// conkey/confkey positions must be paired, never independently sorted.
export const constraintStateSql = `
select r.relname table_name,c.conname name,c.contype kind,
  pg_get_constraintdef(c.oid,true) definition,c.convalidated validated,
  c.condeferrable deferrable,c.condeferred initially_deferred,
  case when c.contype='f' then array(select a.attname::text from
    unnest(c.conkey) with ordinality k(attnum,pos)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    order by k.pos) end columns_from,
  case when c.contype='f' then array(select a.attname::text from
    unnest(c.confkey) with ordinality k(attnum,pos)
    join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum
    order by k.pos) end columns_to,
  case when c.contype='c' then pg_get_expr(c.conbin,c.conrelid,true) end expression
from pg_constraint c join pg_class r on r.oid=c.conrelid
join pg_namespace n on n.oid=c.connamespace
where n.nspname='public' order by table_name,name`;

// indclass is a positional vector; ANY(indclass) loses per-column classes.
export const indexStateSql = `
select r.relname table_name,i.relname name,pg_get_indexdef(x.indexrelid) definition,
  (select json_agg(json_build_object('position',k.pos,'opclass',o.opcname) order by k.pos)
   from unnest(x.indclass::oid[]) with ordinality k(classid,pos)
   join pg_opclass o on o.oid=k.classid) columns
from pg_index x join pg_class i on i.oid=x.indexrelid
join pg_class r on r.oid=x.indrelid join pg_namespace n on n.oid=r.relnamespace
where n.nspname='public' order by table_name,name`;

/** Historical baselines remain public-only; 0081 additionally owns private
 * verification functions and records their namespace/PUBLIC execution rights. */
export async function captureMigrationSqlState(
  db: Pick<DrizzleDb, "execute">,
  includeEarlyBirdPrivate = false,
) {
  const namespaces = includeEarlyBirdPrivate
    ? sql`n.nspname in ('public','early_bird_private')`
    : sql`n.nspname='public'`;
  const functions = await db.execute(sql`
    select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
      pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where ${namespaces} and not exists(select 1 from pg_depend d
      where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
    order by name,arguments`);
  const triggers = await db.execute(sql`
    select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,
      t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by table_name,name`);
  const exclusions = await db.execute(sql`
    select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition
    from pg_constraint c join pg_class r on r.oid=c.conrelid
    join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and c.contype='x' order by table_name,name`);
  const extensions = await db.execute(sql`
    select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`);
  const constraints = await db.execute<
    ConstraintState & Record<string, unknown>
  >(sql.raw(constraintStateSql));
  const indexes = await db.execute<IndexState & Record<string, unknown>>(
    sql.raw(indexStateSql),
  );
  const historical = {
    functions: functions.rows,
    triggers: triggers.rows,
    exclusionConstraints: exclusions.rows,
    extensions: extensions.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  };
  if (!includeEarlyBirdPrivate) return historical;
  const schemas = await db.execute(sql`
    select nspname name,has_schema_privilege('public',oid,'USAGE') public_usage,
      has_schema_privilege('public',oid,'CREATE') public_create
    from pg_namespace where nspname='early_bird_private' order by name`);
  const functionPrivileges = await db.execute(sql`
    select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
      p.prosecdef security_definer,has_function_privilege('public',p.oid,'EXECUTE') public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where ${namespaces} and not exists(select 1 from pg_depend d
      where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
    order by schema,name,arguments`);
  return {
    ...historical,
    schemas: schemas.rows,
    functionPrivileges: functionPrivileges.rows,
  };
}

/** Correct known 0.31.10 losses only from independently captured PostgreSQL state.
 * Unrepresentable flags remain authoritative in the companion catalogue; this is
 * never permission to generate executable SQL from the resulting projection. */
export function normalizeMigrationSnapshot(
  source: DrizzleSnapshotJSON,
  state: { constraints: ConstraintState[]; indexes: IndexState[] },
): DrizzleSnapshotJSON {
  const snapshot = structuredClone(source);
  for (const c of state.constraints) {
    const table = snapshot.tables[`public.${c.table_name}`];
    if (!table) throw new Error("migration_snapshot_table_missing");
    if (c.kind === "f") {
      const fk = table.foreignKeys[c.name];
      if (
        !fk ||
        !c.columns_from?.length ||
        c.columns_from.length !== c.columns_to?.length
      )
        throw new Error("migration_snapshot_foreign_key_missing");
      fk.columnsFrom = c.columns_from;
      fk.columnsTo = c.columns_to;
    }
    if (c.kind === "c") {
      const check = table.checkConstraints[c.name];
      if (!check || !c.expression)
        throw new Error("migration_snapshot_check_missing");
      check.value = c.expression;
    }
  }
  for (const i of state.indexes) {
    const index = snapshot.tables[`public.${i.table_name}`]?.indexes[i.name];
    // Primary/unique/exclusion constraint indexes are represented elsewhere.
    if (!index) continue;
    if (index.columns.length !== i.columns.length)
      throw new Error("migration_snapshot_index_shape_mismatch");
    for (const c of i.columns) {
      const column = index.columns[c.position - 1];
      if (!column) throw new Error("migration_snapshot_index_position_missing");
      column.opclass = c.opclass;
    }
  }
  return snapshot;
}
