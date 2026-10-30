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
