# Selarti authentication probe — 2026-10-12

One authentication request used the configured SELARTI_API_KEY from the active
checkout .env. POST https://selarti.com/api/1.1/wf/auth returned HTTP200 and
status=success. Request contained only the documented key field. No message send,
generation, task/agent change, payment, production flag change or deployment.

Observed shape, values deliberately not persisted:

```
{
  status: string,
  response: {
    user: object,
    token: string,
    user_id: string,
    expires: number
  }
}
```

The user object includes active_company but its value was not compared to the
configured company in this probe. No task/agent ownership claim follows from
authentication alone. The meaning/unit of expires was not established; do not
invent a token TTL from the field name or numeric type. The public collection
has no example authentication response, so this is observed runtime evidence,
not a provider guarantee for every response variant.

Node24 fetch used inherited proxy settings via --use-env-proxy, verified HTTPS,
redirect rejection,15-second timeout and64KiB body cap. Only status, success
boolean and recursive field types were printed. Token, user identity and API key
were neither printed nor written. Temporary token was not persisted.

This removes uncertainty about whether this local API key can authenticate now.
It does not implement token acquisition/refresh, company/task/agent validation,
durable request/response mapping or client delivery. Those remain release gates.
