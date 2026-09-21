import { sql, type SQL } from "drizzle-orm";

/**
 * Единственная формула «текущее решение по цели согласия» (EVID-03; дефект D2 карты W1).
 *
 * До 2026-09-21 существовали две несовместимые деривации одного и того же состояния:
 * `distinct on (consent_type) … order by created_at desc, id desc` (где `id` — случайный uuid,
 * то есть порядок при равных `created_at` произвольный) и `created_at = max(created_at)` с
 * `bool_and(decision = 'granted')`. На двух записях с одинаковым временем они давали разный
 * ответ. Здесь закреплён второй вариант: побеждает самое позднее мгновение, а любая не-`granted`
 * запись в этом мгновении означает «не действует» (fail-closed).
 *
 * `userExpression` — ссылочное выражение: внутри `lateral` это `r.user_id`, вне его —
 * `${userId}::uuid`.
 */
export function currentConsentSatisfiedSql(args: {
  readonly userExpression: SQL;
  readonly purpose: string;
  readonly policyVersion?: SQL;
}): SQL {
  return sql`
    select coalesce(
      bool_and(latest.decision = 'granted'${
        args.policyVersion
          ? sql` and latest.policy_version = ${args.policyVersion}`
          : sql``
      }),
      false
    ) as granted
    from consents latest
    where latest.user_id = ${args.userExpression}
      and latest.consent_type = ${args.purpose}
      and latest.created_at = (
        select max(candidate.created_at)
        from consents candidate
        where candidate.user_id = ${args.userExpression}
          and candidate.consent_type = ${args.purpose}
      )`;
}

/** То же условие как скаляр (для вызовов вне `lateral`). */
export function currentConsentGrantedSql(args: {
  readonly userExpression: SQL;
  readonly purpose: string;
  readonly policyVersion?: SQL;
}): SQL {
  return sql`(${currentConsentSatisfiedSql(args)})`;
}

/**
 * Списочная форма того же правила: по каждой цели — самое позднее мгновение и «действует ли».
 * Нужна ровно одна строка на цель, поэтому `bool_and` здесь группировочный, а не скалярный;
 * семантика ничьей не меняется: смешанные решения в одном мгновении = не действует.
 */
export function currentConsentStatesSql(userId: SQL): SQL {
  return sql`
    select latest.consent_type as purpose,
      coalesce(bool_and(latest.decision = 'granted'), false) as "inForce",
      max(latest.policy_version) as "policyVersion",
      to_char(
        max(latest.created_at) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) as "decidedAt"
    from consents latest
    where latest.user_id = ${userId}
      and latest.created_at = (
        select max(candidate.created_at)
        from consents candidate
        where candidate.user_id = ${userId}
          and candidate.consent_type = latest.consent_type
      )
    group by latest.consent_type
    order by latest.consent_type`;
}
