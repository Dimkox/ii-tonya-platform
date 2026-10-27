# Planerka credential discovery — read-only

Date:2026-10-12. No deployment, calendar creation/cancellation, subscription
purchase, secret rotation or configuration mutation occurred.

Scoped environment-file discovery under /home/pall/projects/ii-tonya-base found
the active checkout .env and .worktrees/tonya-full-update-ci/.env. The former
contains placeholder token/base URL fields. The latter contains account fields
and PLANERKA_CALENDAR_TOKEN. Values were not printed or copied to this document.

The calendar token matches the documented API-key shape. One GET request to
https://planerka.app/rest/v2/me with cal-api-version2024-08-13 returned HTTP401.
Node24 used --use-env-proxy; redirects were rejected; timeout12seconds. Only the
status code was reported; response body was cancelled, not persisted. Password
login was not attempted. This is provider rejection, not proof that no key exists.

Official guide https://help.planerka.app/api inspected on the same date says API
requires a paid plan or active trial and free-plan calls return401. This makes
subscription availability a possible cause, not a verified diagnosis of this
account. Invalid/expired/revoked credentials remain possible. No account/profile
identity or event-type mapping was verified by the unsuccessful request.

Do not promote this token to production or enable creation based on its format.
Next acceptance evidence must include successful profile binding and appropriate
event-type/operation permissions. Keep creation disabled until those facts exist;
do not remove recovery for already issued operations merely to disable creation.
