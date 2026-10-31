"""Run against an already-started *disposable* local postgres container only."""

import os
from pathlib import Path
import subprocess
import unittest

CONTAINER = os.environ.get("GATEWAY_DISPOSABLE_PG_CONTAINER", "")
SQL = Path(__file__).parents[3] / "docs/superpowers/implementation-artifacts/drafts/early_bird_gateway_authority.sql"


def execute(sql, *, check=True):
    return subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=10,
    )


@unittest.skipUnless(CONTAINER == "ii-tonya-gateway-proof-local", "dedicated disposable container required")
class PostgreSQLAuthorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures = """
CREATE TABLE public.early_bird_composite_intents(id uuid PRIMARY KEY,user_id uuid,choice_id uuid,status text,idempotency_key uuid,request_digest text);
CREATE TABLE public.early_bird_composite_requests(intent_id uuid,user_id uuid,idempotency_key uuid,request_digest text,expires_at timestamptz);
CREATE TABLE public.early_bird_receipt_contacts(id uuid PRIMARY KEY,user_id uuid,choice_id uuid,expires_at timestamptz);
CREATE FUNCTION public.early_bird_receipt_authorized(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE TABLE public.receipt_revocation_outbox(contact_id uuid NOT NULL);
CREATE ROLE gateway_test NOLOGIN;
"""
        execute(
            "".join(
                (
                    fixtures,
                    SQL.read_text(),
                    """
GRANT EXECUTE ON FUNCTION public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text),public.early_bird_gateway_revoke(uuid) TO gateway_test;
INSERT INTO early_bird_composite_intents VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','unknown','44444444-4444-4444-8444-444444444444','sha256:'||repeat('a',64));
INSERT INTO early_bird_composite_requests VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','sha256:'||repeat('a',64),now()+interval '1 hour');
INSERT INTO early_bird_receipt_contacts VALUES('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',now()+interval '1 hour');
""",
                )
            )
        )

    def test_claim_once_and_role_cannot_read_tables(self):
        call = "SELECT public.early_bird_gateway_claim('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','sha256:'||repeat('a',64));"
        self.assertEqual(execute("SET ROLE gateway_test; " + call).stdout, b"t\n")
        self.assertEqual(execute("SET ROLE gateway_test; " + call).stdout, b"f\n")
        self.assertNotEqual(
            execute("SET ROLE gateway_test; SELECT * FROM early_bird_gateway_claims;", check=False).returncode, 0
        )

    def test_revocation_persists_after_contact_erasure(self):
        self.assertEqual(
            execute(
                "SET ROLE gateway_test; SELECT public.early_bird_gateway_revoke('66666666-6666-4666-8666-666666666666');"
            ).stdout,
            b"t\n",
        )
        self.assertEqual(
            execute(
                "SELECT revoked_at IS NOT NULL FROM early_bird_gateway_contact_state WHERE contact_id='66666666-6666-4666-8666-666666666666';"
            ).stdout,
            b"t\n",
        )


if __name__ == "__main__":
    unittest.main()
