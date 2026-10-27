import type { DrizzleSnapshotJSON } from "drizzle-kit/api";

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
