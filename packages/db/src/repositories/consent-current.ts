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

/**
 * EGRESS-01/03 (приёмка T18/T25): барьер исходящих. Строка очереди считается разрешённой к
 * выдаче только если согласие субъекта диалога действует по тому же правилу, что и read-гейты.
 * Отсутствие диалога или субъекта = не разрешено (fail-closed): молча отправить «неизвестно
 * чьё» сообщение хуже, чем оставить его в очереди.
 */
export function dialogueConsentEgressPredicate(
  dialogueId: SQL,
  purpose: string,
): SQL {
  return sql`
    exists (
      select 1
      from dialogues gated
      where gated.id = ${dialogueId}
        and ${currentConsentGrantedSql({
          userExpression: sql`gated.user_id`,
          purpose,
        })}
    )`;
}

/** Original evidence lookup, next to the sole journal oracle. Projection is only a fence. */
export function originalClientConsentSql(
  userId: string,
  purpose: "client_messaging" | "selarti_ai_processing",
): SQL {
  const prefix =
    purpose === "client_messaging" ? "client-messaging" : "selarti-ai";
  return sql`
    select c.id::text as "decisionId", s.revision::text as revision,
      c.policy_version as "policyVersion"
    from consent_states s
    join consents c on c.id=s.last_decision_id and c.user_id=s.user_id
      and c.consent_type=s.purpose and c.decision='granted'
    join consent_document_versions d on d.id=c.document_version_id
      and d.id=s.document_version_id
    join consent_presentations p on p.id=c.presentation_id
      and p.user_id=c.user_id and p.purpose=c.consent_type
      and p.document_version_id=d.id and p.channel=c.channel
    where s.user_id=${userId}::uuid and s.purpose=${purpose}
      and s.decision='granted' and s.revision>0
      and c.basis='consent' and c.scope_fields='{}'::jsonb
      and c.recipient_id is null and c.reservation_id is null
      and c.text_sha256=d.text_sha256
      and d.document_key=${`consent.${purpose}`} and d.status='approved'
      and d.effective_at<=clock_timestamp()
      and d.version=(select max(candidate.version) from consent_document_versions candidate
        where candidate.document_key=d.document_key and candidate.status='approved'
          and candidate.effective_at<=clock_timestamp())
      and (c.policy_version=${prefix}||'-v'||d.version::text
        ${purpose === "client_messaging" ? sql`or c.policy_version='messaging-v'||d.version::text` : sql``})
      and p.consumed_at is not null and p.invalidated_at is null
      and p.consumed_at>=p.created_at and p.consumed_at<p.expires_at
      and c.created_at>=p.created_at
      and c.created_at=(select max(candidate.created_at) from consents candidate
        where candidate.user_id=c.user_id and candidate.consent_type=c.consent_type)
      and ${currentConsentGrantedSql({ userExpression: sql`s.user_id`, purpose, policyVersion: sql`c.policy_version` })}
    for share of s,c,p`;
}
