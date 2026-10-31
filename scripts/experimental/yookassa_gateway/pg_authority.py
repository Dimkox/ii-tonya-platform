"""Experimental gateway-only PostgreSQL authority client; no network transport.

Credentials are resolved by libpq through a protected service/passfile. Calls
run in separate transactions, so a successful result is returned only after the
claim/revoke transaction has committed. Configure PostgreSQL statement_timeout
and lock_timeout in the service. A timeout or lost result is always denied.
"""

import os
import re
import subprocess
import uuid
from pathlib import Path


class PgAuthority:
    def __init__(self, *, psql_path, service, service_file, pass_file, timeout=5):
        if not os.path.isabs(psql_path) or not os.path.isabs(service_file) or not os.path.isabs(pass_file):
            raise ValueError("absolute protected paths required")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", service) or not 0 < timeout <= 30:
            raise ValueError("invalid service")
        self.psql_path, self.service, self.service_file, self.pass_file, self.timeout = (
            psql_path,
            service,
            service_file,
            pass_file,
            timeout,
        )

    @staticmethod
    def _uuid(value):
        parsed = uuid.UUID(value)
        if str(parsed) != value:
            raise ValueError("invalid identifier")
        return value

    def _run(self, sql):
        env = {
            "PGSERVICE": self.service,
            "PGSERVICEFILE": self.service_file,
            "PGPASSFILE": self.pass_file,
            "PGCONNECT_TIMEOUT": "3",
        }
        try:
            proc = subprocess.run(
                [self.psql_path, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                input=sql.encode("ascii"),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=env,
                timeout=self.timeout,
                check=False,
            )
            return proc.returncode == 0 and proc.stdout == b"t\n"
        except (OSError, subprocess.TimeoutExpired):
            return False

    def check_readiness(self):
        try:
            query = Path(__file__).with_name("readiness.sql").read_text(encoding="ascii")
        except OSError:
            return False
        return self._run(query)

    def revoke(self, contact_id):
        contact = self._uuid(contact_id)
        return self._run("SELECT public.early_bird_gateway_revoke('" + contact + "'::uuid);\n")

    def claim(self, user_id, intent_id, contact_id, idempotency_key, digest):
        ids = [self._uuid(value) for value in (user_id, intent_id, contact_id, idempotency_key)]
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            raise ValueError("invalid digest")
        args = ",".join("'" + value + "'::uuid" for value in ids)
        return self._run("SELECT public.early_bird_gateway_claim(" + args + ",'" + digest + "');\n")

    def claim_public(self, user_id, request_id, contact_id, idempotency_key, digest, kind):
        claim = (user_id, request_id, contact_id, idempotency_key, digest, kind)
        try:
            ids = [self._uuid(value) for value in (user_id, request_id, idempotency_key)]
            contact = "NULL" if contact_id is None else "'" + self._uuid(contact_id) + "'::uuid"
            if kind not in PUBLIC_KINDS or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
                return None
            sql = (
                "SELECT public.public_expert_gateway_claim('"
                + ids[0]
                + "'::uuid,'"
                + ids[1]
                + "'::uuid,"
                + contact
                + ",'"
                + ids[2]
                + "'::uuid,'"
                + digest
                + "','"
                + kind
                + "');\n"
            )
            proc = subprocess.run(
                [self.psql_path, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                input=sql.encode("ascii"),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env={
                    "PGSERVICE": self.service,
                    "PGSERVICEFILE": self.service_file,
                    "PGPASSFILE": self.pass_file,
                    "PGCONNECT_TIMEOUT": "3",
                },
                timeout=self.timeout,
                check=False,
            )
            if proc.returncode != 0 or len(proc.stdout) > 524288:
                return None
            return validate_public_claim(strict_json(proc.stdout), claim)
        except (ValueError, TypeError, KeyError, OSError, subprocess.TimeoutExpired):
            return None


def strict_json(data):
    import json

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("invalid JSON")
            result[key] = value
        return result

    def invalid(_):
        raise ValueError("invalid JSON")

    return json.loads(data, object_pairs_hook=unique, parse_constant=invalid)


PUBLIC_KINDS = frozenset(("onboarding_create", "onboarding_capture", "onboarding_cancel", "main_create", "main_refund"))
PUBLIC_KEYS = frozenset(
    (
        "version",
        "requestId",
        "userId",
        "product",
        "kind",
        "legacySourceId",
        "legacyOperationId",
        "mode",
        "amountMinor",
        "currency",
        "idempotencyKey",
        "contactId",
        "parentPaymentId",
        "requestDigest",
        "bodyVersion",
        "bodyExpiresAt",
        "paymentDeadline",
        "providerDeadline",
        "createdAt",
        "state",
        "providerObjectId",
        "envelope",
    )
)


def validate_public_claim(row, claim):
    """Strict Task1 snapshot boundary. No caller-provided parent/path is accepted."""
    import datetime

    if not isinstance(row, dict) or set(row) != PUBLIC_KEYS:
        raise ValueError("invalid public claim")
    user, request, contact, idempotency, digest, kind = claim
    if (
        row["userId"],
        row["requestId"],
        row["contactId"],
        row["idempotencyKey"],
        row["requestDigest"],
        row["kind"],
    ) != claim:
        raise ValueError("public claim mismatch")
    free = kind in ("onboarding_capture", "onboarding_cancel")
    parent = free or kind == "main_refund"
    if (
        kind not in PUBLIC_KINDS
        or type(row["version"]) is not int
        or row["version"] != 1
        or type(row["bodyVersion"]) is not int
        or row["bodyVersion"] != 1
        or row["state"] != "uncertain"
        or row["mode"] not in ("test", "live")
        or row["currency"] != "RUB"
        or not isinstance(row["amountMinor"], str)
        or not re.fullmatch(r"[1-9][0-9]{0,11}", row["amountMinor"])
        or row["product"] != ("refund" if kind == "main_refund" else "main" if kind == "main_create" else "onboarding")
        or (kind.startswith("onboarding_") and row["amountMinor"] != "300000")
        or free != (contact is None)
        or free != (row["bodyExpiresAt"] is None)
        or parent != (row["parentPaymentId"] is not None)
        or not isinstance(digest, str)
        or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
    ):
        raise ValueError("invalid public claim")
    for key in ("requestId", "userId", "legacySourceId", "legacyOperationId", "idempotencyKey", "contactId"):
        if key == "contactId" and row[key] is None:
            continue
        if not isinstance(row[key], str):
            raise ValueError("invalid public claim")
        PgAuthority._uuid(row[key])
    for key in ("parentPaymentId", "providerObjectId"):
        if row[key] is not None and (
            not isinstance(row[key], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", row[key])
        ):
            raise ValueError("invalid public claim")
    if free and row["providerObjectId"] != row["parentPaymentId"]:
        raise ValueError("invalid public claim")
    times = {}
    for key in ("bodyExpiresAt", "paymentDeadline", "providerDeadline", "createdAt"):
        value = row[key]
        if value is None and key == "bodyExpiresAt":
            continue
        if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)", value
        ):
            raise ValueError("invalid public claim")
        times[key] = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if times["paymentDeadline"] > times["providerDeadline"]:
        raise ValueError("invalid public claim")
    envelope = row["envelope"]
    if free and envelope is not None:
        raise ValueError("invalid public claim")
    if not free and (
        not isinstance(envelope, dict)
        or set(envelope) != {"ciphertext", "keyReference"}
        or not isinstance(envelope["ciphertext"], str)
        or not 1 <= len(envelope["ciphertext"]) <= 262144
        or not isinstance(envelope["keyReference"], str)
        or not re.fullmatch(r"[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}", envelope["keyReference"])
    ):
        raise ValueError("invalid public claim")
    return row
