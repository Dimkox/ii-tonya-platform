import {
  parseClientAccountPackages,
  type ClientAccountPackages,
  type ClientAccountPackagesRepository,
} from "@ii-tonya/contracts";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

/** One snapshot covers list, corruption checks and the uncapped total. */
export class PostgresClientAccountPackagesRepository implements ClientAccountPackagesRepository {
  constructor(private readonly db: DrizzleDb) {}
  async read(userId: string): Promise<ClientAccountPackages> {
    try {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          userId,
        )
      )
        throw new Error("invalid_user");
      return await this.db.transaction(
        async (tx) => {
          await tx.execute(sql`set local statement_timeout = '2500ms'`);
          await tx.execute(sql`set local lock_timeout = '500ms'`);
          const result = await tx.execute<{
            snapshot: unknown;
            corrupt: boolean;
          }>(sql`
          with clock as materialized (
            select transaction_timestamp() as as_of
          ), owned as materialized (
            select p.id, p.kind, p.granted_messages, p.expires_at, p.granted_at,
              b.balance,
              case when p.expires_at <= c.as_of then 'expired'
                   when b.balance = 0 then 'exhausted' else 'active' end as status
            from message_packages p
            left join package_balances b on b.package_id = p.id and b.user_id = p.user_id
            cross join clock c
            where p.user_id = ${userId}::uuid
          ), limited as (
            select * from owned
            order by (status = 'active') desc, expires_at asc nulls last, granted_at asc, id asc
            limit 50
          )
          select jsonb_build_object(
            'asOf', to_char(c.as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'totalRemainingUnits', (select coalesce(sum(balance) filter (where status = 'active'), 0)::text from owned),
            'hasMore', (select count(*) > 50 from owned),
            'packages', coalesce((select jsonb_agg(jsonb_build_object(
              'id', id, 'kind', kind, 'grantedUnits', granted_messages,
              'remainingUnits', balance::text,
              'expiresAt', case when expires_at is null then null else to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
              'status', status
            ) order by (status = 'active') desc, expires_at asc nulls last, granted_at asc, id asc) from limited), '[]'::jsonb)
          ) as snapshot,
          exists(select 1 from owned where balance is null or balance < 0 or granted_messages <= 0 or kind not in ('paid', 'admin', 'intro') or not isfinite(expires_at)) as corrupt
          from clock c
        `);
          const row = result.rows[0];
          if (!row || row.corrupt) throw new Error("corrupt_package");
          return parseClientAccountPackages(row.snapshot);
        },
        { accessMode: "read only" },
      );
    } catch {
      throw new Error("client_packages_unavailable");
    }
  }
}
