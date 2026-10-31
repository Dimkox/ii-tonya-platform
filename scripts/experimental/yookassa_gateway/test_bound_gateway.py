import hashlib
import base64
import hmac
import json
import os
import socket
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch
from pg_authority import PgAuthority

from bound_gateway import BoundGateway
from ipc import GatewayServer
from nonce_registry import NonceRegistry
from subject_tokens import contact_token
import test_gateway


class BoundGatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_gateway.HttpGatewayTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        test_gateway.HttpGatewayTests.tearDownClass()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state_dir = os.path.join(self.temp.name, "state")
        os.mkdir(self.state_dir, 0o700)
        self.runtime = BoundGateway(self.state_dir, synthetic_fresh_start=True)
        self.registry = NonceRegistry.initialize(os.path.join(self.temp.name, "nonce.sqlite"), b"a" * 32)
        self.address = "\0bound-test-" + os.urandom(16).hex()
        self.server = GatewayServer(
            self.address,
            erase=self.runtime.revoke_user,
            stop_all=self.runtime.stop_all,
            dispatch=lambda _: None,
            allowed_pids={os.getpid()},
            auth_key=b"a" * 32,
            nonce_registry=self.registry,
            merchant_auth=("1", "s"),
            provider_host="localhost",
            confirmation_hosts={"checkout.example"},
        )
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        self.helper = test_gateway.HttpGatewayTests()

    def tearDown(self):
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.registry.close()
        self.runtime.close()
        self.temp.cleanup()

    def command(self, command):
        nonce = os.urandom(32).hex()
        body = json.dumps(command, sort_keys=True, separators=(",", ":"))
        with socket.socket(socket.AF_UNIX) as conn:
            conn.connect(self.address)
            conn.sendall(json.dumps({"hello": nonce}).encode() + b"\n")
            reader = conn.makefile("rb")
            hello = json.loads(reader.readline())
            challenge = hello["challenge"]
            expected = hmac.new(b"a" * 32, ("hello\n" + nonce + "\n" + challenge).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(hello["mac"], expected)
            mac = hmac.new(
                b"a" * 32, ("request\n" + nonce + "\n" + challenge + "\n" + body).encode(), hashlib.sha256
            ).hexdigest()
            conn.sendall(
                json.dumps({"nonce": nonce, "challenge": challenge, "body": body, "mac": mac}).encode() + b"\n"
            )
            return json.loads(reader.readline())["outcome"]

    def valid_request(self, host="localhost"):
        body = b'{"synthetic":true}'
        return (
            b"POST /v3/payments HTTP/1.1\r\nHost: "
            + host.encode()
            + b"\r\nIdempotence-Key: test-key\r\nContent-Type: application/json\r\nContent-Length: "
            + str(len(body)).encode()
            + b"\r\nConnection: close\r\n\r\n"
            + body
        )

    def test_ipc_revocation_before_first_write_blocks_tls_send(self):
        prepare, got, server_thread = self.helper.server()
        ready, resume = threading.Event(), threading.Event()
        subject = b"v" * 32
        result = []
        worker = threading.Thread(
            target=lambda: result.append(
                self.runtime.dispatch(
                    subject,
                    b"1" * 32,
                    prepare,
                    self.helper.req(b"synthetic"),
                    before_admission=lambda: (ready.set(), resume.wait(3)),
                )
            )
        )
        worker.start()
        self.assertTrue(ready.wait(3))
        self.assertEqual(self.command({"op": "revoke_user", "subject": subject.hex()}), "erased")
        resume.set()
        worker.join(3)
        server_thread.join(3)
        self.assertEqual(result, ["cancelled"])
        self.assertEqual(got, [b""])

    def test_real_tls_send_uses_durable_attempt_and_restart_disarms(self):
        subject = b"z" * 32
        prepare, got, thread = self.helper.server()
        result = self.runtime.dispatch(subject, b"2" * 32, prepare, self.helper.req(b"synthetic"))
        thread.join(3)
        self.assertEqual(result["payment_status"], "pending")
        self.assertEqual(got, [b"synthetic"])
        self.runtime.close()
        self.runtime = BoundGateway(self.state_dir)
        prepare, got, thread = self.helper.server()
        self.assertEqual(self.runtime.dispatch(subject, b"2" * 32, prepare, self.helper.req(b"synthetic")), "cancelled")
        thread.join(3)
        self.assertEqual(got, [b""])

    def test_distinct_attempts_send_once_and_same_attempt_cannot_repeat(self):
        for attempt, expected in [(b"1" * 32, True), (b"2" * 32, True), (b"1" * 32, False)]:
            prepare, got, thread = self.helper.server()
            result = self.runtime.dispatch(b"z" * 32, attempt, prepare, self.helper.req(b"synthetic"))
            thread.join(3)
            self.assertEqual(got, [b"synthetic" if expected else b""])
            if expected:
                self.assertEqual(result["payment_status"], "pending")
            else:
                self.assertEqual(result, "cancelled")

    def test_authenticated_dispatch_reaches_fixed_tls_provider_and_sanitizes_response(self):
        body = json.dumps(
            {
                "id": "abc-123",
                "status": "pending",
                "confirmation": {"confirmation_url": "https://checkout.example/pay"},
                "customer": {"email": "hidden@example.com"},
            },
            separators=(",", ":"),
        ).encode()
        response = b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        prepare, got, thread = self.helper.server(response=response)
        self.server._dispatch = lambda subject, attempt, request: self.runtime.dispatch(
            subject, attempt, prepare, request, confirmation_hosts={"checkout.example"}
        )
        request = self.valid_request()
        outcome = self.command(
            {
                "op": "dispatch",
                "subject": (b"p" * 32).hex(),
                "attempt": (b"q" * 32).hex(),
                "request": base64.b64encode(request).decode(),
            }
        )
        thread.join(3)
        self.assertEqual(got, [b'{"synthetic":true}'])
        self.assertTrue(outcome.startswith("response:"))
        result = json.loads(base64.urlsafe_b64decode(outcome[9:] + "=" * ((-len(outcome[9:])) % 4)))
        self.assertEqual(
            result,
            {"payment_id": "abc-123", "payment_status": "pending", "confirmation_url": "https://checkout.example/pay"},
        )
        self.assertNotIn("hidden", outcome)

    def test_composed_ipc_server_uses_fixed_provider_transport(self):
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.server = self.runtime.create_ipc_server(
            self.address,
            auth_key=b"a" * 32,
            nonce_registry=self.registry,
            allowed_pids={os.getpid()},
            confirmation_hosts={"checkout.example"},
            merchant_auth=("1", "s"),
        )
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        body = json.dumps(
            {
                "id": "abc-123",
                "status": "pending",
                "confirmation": {"confirmation_url": "https://checkout.example/pay"},
            },
            separators=(",", ":"),
        ).encode()
        response = b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        prepare, got, tls_thread = self.helper.server(response=response)
        request = self.valid_request("api.yookassa.ru")
        with patch("bound_gateway.prepare_yookassa_tls", prepare):
            outcome = self.command(
                {
                    "op": "dispatch",
                    "subject": (b"p" * 32).hex(),
                    "attempt": (b"q" * 32).hex(),
                    "request": base64.b64encode(request).decode(),
                }
            )
        tls_thread.join(3)
        self.assertTrue(outcome.startswith("response:"))
        self.assertEqual(got, [b'{"synthetic":true}'])

    def test_final_provider_status_without_confirmation_is_returned(self):
        body = b'{"id":"abc-123","status":"succeeded"}'
        response = b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        prepare, got, thread = self.helper.server(response=response)
        self.server._dispatch = lambda subject, attempt, request: self.runtime.dispatch(
            subject, attempt, prepare, request, confirmation_hosts={"checkout.example"}
        )
        request = self.valid_request()
        outcome = self.command(
            {
                "op": "dispatch",
                "subject": (b"p" * 32).hex(),
                "attempt": (b"q" * 32).hex(),
                "request": base64.b64encode(request).decode(),
            }
        )
        thread.join(3)
        self.assertTrue(outcome.startswith("response:"))
        result = json.loads(base64.urlsafe_b64decode(outcome[9:] + "=" * ((-len(outcome[9:])) % 4)))
        self.assertEqual(result, {"payment_id": "abc-123", "payment_status": "succeeded"})

    def test_composed_contact_gateway_rejects_legacy_user_revoke(self):
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.server = self.runtime.create_ipc_server(
            self.address,
            auth_key=b"a" * 32,
            nonce_registry=self.registry,
            allowed_pids={os.getpid()},
            confirmation_hosts={"checkout.example"},
            merchant_auth=("1", "s"),
        )
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        self.assertEqual(self.command({"op": "revoke_user", "subject": (b"p" * 32).hex()}), "invalid")

    def test_dispatch_rejects_untrusted_host_or_ambiguous_request(self):
        calls = []
        self.server._dispatch = lambda *args: calls.append(args)
        subject, attempt = (b"p" * 32).hex(), (b"q" * 32).hex()
        for raw in [
            self.helper.req(b"x").replace(b"Host: localhost", b"Host: attacker.example"),
            self.helper.req(b"x").replace(b"Connection: close", b"Transfer-Encoding: chunked"),
        ]:
            outcome = self.command(
                {"op": "dispatch", "subject": subject, "attempt": attempt, "request": base64.b64encode(raw).decode()}
            )
            self.assertEqual(outcome, "invalid")
        self.assertEqual(calls, [])

    def test_dispatch_rejects_caller_auth_and_non_json_body(self):
        calls = []
        self.server._dispatch = lambda *args: calls.append(args)
        raw = self.valid_request().replace(b"Host: localhost", b"Host: localhost\r\nAuthorization: Basic MTpz")
        outcome = self.command(
            {
                "op": "dispatch",
                "subject": (b"p" * 32).hex(),
                "attempt": (b"q" * 32).hex(),
                "request": base64.b64encode(raw).decode(),
            }
        )
        self.assertEqual(outcome, "invalid")
        self.assertEqual(calls, [])

    def test_expired_contact_revocation_does_not_block_new_contact(self):
        old = contact_token(b"k" * 32, "12345678-abcd-4abc-8abc-123456789abc")
        new = contact_token(b"k" * 32, "12345678-abcd-4abc-8abc-123456789abd")
        self.assertEqual(self.command({"op": "revoke_contact", "subject": old.hex()}), "erased")
        prepare, got, thread = self.helper.server()
        self.assertEqual(self.runtime.dispatch(old, b"1" * 32, prepare, self.helper.req(b"x")), "cancelled")
        thread.join(3)
        self.assertEqual(got, [b""])
        prepare, got, thread = self.helper.server()
        result = self.runtime.dispatch(new, b"2" * 32, prepare, self.helper.req(b"x"))
        thread.join(3)
        self.assertEqual(result["payment_status"], "pending")
        self.assertEqual(got, [b"x"])

    def test_revoke_ack_waits_for_concurrent_send_and_blocks_later_sends(self):
        subject = b"r" * 32
        prepare, got, thread = self.helper.server()
        entered, resume, revoke_done = threading.Event(), threading.Event(), threading.Event()

        class HeldConnection:
            def __init__(self, inner):
                self.inner = inner

            def setblocking(self, value):
                self.inner.setblocking(value)

            def send(self, data):
                entered.set()
                if not resume.wait(3):
                    raise TimeoutError("test timed out")
                return self.inner.send(data)

            def recv(self, size):
                return self.inner.recv(size)

            def fileno(self):
                return self.inner.fileno()

            def close(self):
                self.inner.close()

        result, ack = [], []
        sender = threading.Thread(
            target=lambda: result.append(
                self.runtime.dispatch(subject, b"1" * 32, lambda: HeldConnection(prepare()), self.helper.req(b"x"))
            )
        )
        sender.start()
        self.assertTrue(entered.wait(3))

        def revoke():
            ack.append(self.command({"op": "revoke_contact", "subject": subject.hex()}))
            revoke_done.set()

        revoker = threading.Thread(target=revoke)
        revoker.start()
        self.assertFalse(revoke_done.wait(0.1))
        resume.set()
        sender.join(3)
        revoker.join(3)
        thread.join(3)
        self.assertEqual(ack, ["erased"])
        self.assertEqual(got, [b"x"])
        prepare, got, thread = self.helper.server()
        self.assertEqual(self.runtime.dispatch(subject, b"2" * 32, prepare, self.helper.req(b"x")), "cancelled")
        thread.join(3)
        self.assertEqual(got, [b""])

    def test_pg_claim_precedes_first_write_and_revoke_precedes_ack(self):
        self.runtime.close()

        class Authority:
            claims = []
            revokes = []

            def claim(self, *args):
                self.claims.append(args)
                return True

            def revoke(self, contact):
                self.revokes.append(contact)
                return True

        authority = Authority()
        self.runtime = BoundGateway(self.state_dir, synthetic_fresh_start=True, authority=authority)
        subject, attempt = b"p" * 32, b"q" * 32
        metadata = (
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
            "sha256:" + "a" * 64,
        )
        prepare, got, thread = self.helper.server()
        result = self.runtime.dispatch(subject, attempt, prepare, self.helper.req(b"x"), authority_claim=metadata)
        thread.join(3)
        self.assertEqual(result["payment_status"], "pending")
        self.assertEqual(authority.claims, [metadata])
        self.runtime.revoke_contact(subject, metadata[2])
        self.assertEqual(authority.revokes, [metadata[2]])

    def test_pg_backed_ipc_binds_contact_attempt_and_body_before_tls(self):
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.runtime.close()

        class Authority:
            claims = []
            revokes = []

            def claim(self, *args):
                self.claims.append(args)
                return True

            def revoke(self, contact):
                self.revokes.append(contact)
                return True

        authority = Authority()
        self.runtime = BoundGateway(self.state_dir, synthetic_fresh_start=True, authority=authority)
        self.server = self.runtime.create_ipc_server(
            self.address,
            auth_key=b"a" * 32,
            nonce_registry=self.registry,
            allowed_pids={os.getpid()},
            confirmation_hosts={"checkout.example"},
            merchant_auth=("1", "s"),
            subject_key=b"k" * 32,
        )
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        user = "11111111-1111-4111-8111-111111111111"
        intent = "22222222-2222-4222-8222-222222222222"
        contact = "33333333-3333-4333-8333-333333333333"
        idem = "44444444-4444-4444-8444-444444444444"
        subject = contact_token(b"k" * 32, contact).hex()
        attempt = hashlib.sha256(uuid.UUID(idem).bytes).hexdigest()
        body = b'{"synthetic":true}'
        request = self.valid_request("api.yookassa.ru").replace(b"test-key", idem.encode())
        response_body = (
            b'{"id":"abc-123","status":"pending","confirmation":{"confirmation_url":"https://checkout.example/pay"}}'
        )
        response = (
            b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(response_body)).encode() + b"\r\n\r\n" + response_body
        )
        prepare, got, tls_thread = self.helper.server(response=response)
        with patch("bound_gateway.prepare_yookassa_tls", prepare):
            outcome = self.command(
                {
                    "op": "dispatch",
                    "subject": subject,
                    "attempt": attempt,
                    "request": base64.b64encode(request).decode(),
                    "user_id": user,
                    "intent_id": intent,
                    "contact_id": contact,
                    "idempotency_key": idem,
                }
            )
        tls_thread.join(3)
        self.assertTrue(outcome.startswith("response:"))
        self.assertEqual(
            authority.claims, [(user, intent, contact, idem, "sha256:" + hashlib.sha256(body).hexdigest())]
        )
        self.assertEqual(self.command({"op": "revoke_contact", "subject": subject, "contact_id": contact}), "erased")
        self.assertEqual(authority.revokes, [contact])

    def test_resumption_requires_existing_state_and_real_pg_readiness(self):
        self.runtime.close()
        authority = PgAuthority(
            psql_path="/usr/bin/psql",
            service="test",
            service_file=os.path.join(self.temp.name, "service"),
            pass_file=os.path.join(self.temp.name, "credential"),
        )
        self.runtime = BoundGateway(self.state_dir, authority=authority, require_existing=True)
        with patch.object(PgAuthority, "check_readiness", return_value=False, create=True):
            self.assertFalse(self.runtime.resume_from_authority())
        with patch.object(PgAuthority, "check_readiness", return_value=True, create=True):
            self.assertTrue(self.runtime.resume_from_authority())
        self.runtime.stop_all()
        self.runtime.close()
        self.runtime = BoundGateway(self.state_dir, authority=authority, require_existing=True)
        with patch.object(PgAuthority, "check_readiness", return_value=True, create=True):
            self.assertFalse(self.runtime.resume_from_authority())
        empty = os.path.join(self.temp.name, "missing")
        os.mkdir(empty, 0o700)
        with self.assertRaises(FileNotFoundError):
            BoundGateway(empty, authority=authority, require_existing=True)

    def test_runtime_fault_cannot_be_rearmed_by_readiness(self):
        self.runtime.close()
        authority = PgAuthority(
            psql_path="/usr/bin/psql",
            service="test",
            service_file=os.path.join(self.temp.name, "service"),
            pass_file=os.path.join(self.temp.name, "credential"),
        )
        self.runtime = BoundGateway(self.state_dir, authority=authority, require_existing=True)
        with patch.object(PgAuthority, "check_readiness", return_value=True, create=True):
            self.assertTrue(self.runtime.resume_from_authority())
            with patch.object(PgAuthority, "revoke", return_value=False):
                with self.assertRaises(RuntimeError):
                    self.runtime.revoke_contact(b"p" * 32, "12345678-abcd-4abc-8abc-123456789abc")
            self.assertFalse(self.runtime.resume_from_authority())

    def test_barrier_requires_ready_pg_backed_runtime(self):
        self.assertFalse(self.runtime.barrier())
        self.runtime.close()
        authority = PgAuthority(
            psql_path="/usr/bin/psql",
            service="test",
            service_file=os.path.join(self.temp.name, "service"),
            pass_file=os.path.join(self.temp.name, "credential"),
        )
        self.runtime = BoundGateway(self.state_dir, authority=authority, require_existing=True)
        with patch.object(PgAuthority, "check_readiness", return_value=True):
            self.assertTrue(self.runtime.resume_from_authority())
            self.assertTrue(self.runtime.barrier())
            self.runtime.stop_all()
            self.assertFalse(self.runtime.barrier())

    def test_ipc_global_stop_blocks_tls_send(self):
        self.assertEqual(self.command({"op": "stop_all"}), "stopped")
        prepare, got, server_thread = self.helper.server()
        self.assertEqual(
            self.runtime.dispatch(b"w" * 32, b"3" * 32, prepare, self.helper.req(b"synthetic")), "cancelled"
        )
        server_thread.join(3)
        self.assertEqual(got, [b""])
