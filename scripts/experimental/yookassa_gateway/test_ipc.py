import json
import hashlib
import hmac
import os
import socket
import tempfile
import subprocess
import sys
import threading
import time
import unittest

from ipc import GatewayServer
from durable_state import DurableState
from subject_tokens import user_token
from nonce_registry import NonceRegistry


class GatewayIpcTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = '\0test-gateway-' + os.urandom(16).hex()
        self.deleted = []
        self.sent = []
        self.auth = b'a' * 32
        self.registry = NonceRegistry.initialize(os.path.join(self.directory.name, 'nonces.sqlite'), self.auth)
        self.server = GatewayServer(self.path, auth_key=self.auth, nonce_registry=self.registry, erase=self.deleted.append,
                                    dispatch=lambda token: self.sent.append(token) or 'started', allowed_pids={os.getpid()}, callback_timeout=0.1)
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))

    def tearDown(self):
        self.server.close()
        self.thread.join(2)
        self.registry.close()
        self.directory.cleanup()

    def request(self, command):
        with socket.socket(socket.AF_UNIX) as conn:
            conn.connect(self.path)
            nonce = os.urandom(32).hex()
            conn.sendall(json.dumps({'hello': nonce}).encode() + b'\n')
            reader = conn.makefile('rb')
            hello = json.loads(reader.readline())
            challenge = hello['challenge']
            expected_hello = hmac.new(self.auth, ('hello\n' + nonce + '\n' + challenge).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(hello['mac'], expected_hello)
            body = json.dumps(command, separators=(',', ':'), sort_keys=True)
            mac = hmac.new(self.auth, ('request\n' + nonce + '\n' + challenge + '\n' + body).encode(), hashlib.sha256).hexdigest()
            conn.sendall(json.dumps({'nonce': nonce, 'challenge': challenge, 'body': body, 'mac': mac}).encode() + b'\n')
            response = json.loads(reader.readline())
            expected = hmac.new(self.auth, ('response\n' + nonce + '\n' + challenge + '\n' + response['outcome']).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(response['mac'], expected)
            self.assertEqual(response['nonce'], nonce)
            return {'outcome': response['outcome']}

    def test_typed_provider_read_returns_only_sanitized_result(self):
        class Reader:
            def inspect_payment(self, payment_id):
                return {'id':payment_id, 'status':'pending', 'paid':False, 'test':True,
                    'amount':{'value':'10.00','currency':'RUB'}, 'created_at':'2026-01-01T00:00:00Z', 'metadata':{}}
        import base64
        self.server.provider_reader = Reader()
        outcome = self.request({'op':'inspect_payment','payment_id':'abc-123'})['outcome']
        self.assertTrue(outcome.startswith('response:'))
        decoded = json.loads(base64.urlsafe_b64decode(outcome[9:] + '='*((-len(outcome[9:]))%4)))
        self.assertEqual(decoded['id'], 'abc-123')

    def test_allowed_uid_accepts_authenticated_peer_after_pid_restart(self):
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.server = GatewayServer(self.path, erase=self.deleted.append, dispatch=lambda _: None,
            stop_all=lambda: None, allowed_pids=None, allowed_uid=os.getuid(), auth_key=self.auth, nonce_registry=self.registry)
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        program = r"""
import hashlib, hmac, json, os, socket, sys
nonce=os.urandom(32).hex()
with socket.socket(socket.AF_UNIX) as conn:
    conn.connect('\0'+sys.argv[1])
    conn.sendall(json.dumps({'hello':nonce}).encode()+b'\n')
    reader=conn.makefile('rb'); hello=json.loads(reader.readline()); challenge=hello['challenge']
    body='{"op":"stop_all"}'
    mac=hmac.new(b'a'*32, ('request\n'+nonce+'\n'+challenge+'\n'+body).encode(), hashlib.sha256).hexdigest()
    conn.sendall(json.dumps({'nonce':nonce,'challenge':challenge,'body':body,'mac':mac}).encode()+b'\n')
    print(json.loads(reader.readline())['outcome'])
"""
        for _ in range(2):
            completed = subprocess.run([sys.executable, '-c', program, self.path[1:]], capture_output=True, timeout=3)
            self.assertEqual(completed.returncode, 0)
            self.assertEqual(completed.stdout, b'stopped\n')

    def test_rejects_peer_uid_not_explicitly_allowed(self):
        self.server.allowed_uid = os.getuid() + 1000000
        with socket.socket(socket.AF_UNIX) as conn:
            conn.connect(self.path)
            conn.sendall(json.dumps({'hello': 'ef'*32}).encode()+b'\n')
            try:
                response = conn.recv(1024)
            except ConnectionResetError:
                response = b''
            self.assertEqual(response, b'')

    def test_gateway_rejects_registry_bound_to_another_key(self):
        with self.assertRaises(ValueError):
            GatewayServer(self.path + 'other', erase=lambda _: None, dispatch=lambda _: None,
                allowed_pids={os.getpid()}, auth_key=b'b'*32, nonce_registry=self.registry)

    def test_replayed_nonce_and_bad_signature_are_rejected(self):
        nonce, challenge = 'ab' * 32, 'cd' * 32
        body = '{"op":"stop_all"}'
        signature = hmac.new(self.auth, ('request\n' + nonce + '\n' + challenge + '\n' + body).encode(), hashlib.sha256).hexdigest()
        envelope = json.dumps({'nonce': nonce, 'challenge': challenge, 'body': body, 'mac': signature}).encode() + b'\n'
        self.server.stop_all = lambda: None
        self.assertEqual(self.server._handle(envelope, nonce, challenge)['outcome'], 'stopped')
        self.assertIsNone(self.server._handle(envelope, nonce, challenge))
        self.assertIsNone(self.server._handle(envelope, nonce, 'ef'*32))

    def test_same_nonce_rejected_after_real_server_restart(self):
        nonce = 'ef' * 32
        body = '{"op":"revoke_user","subject":"' + 'ab'*32 + '"}'
        def send():
            with socket.socket(socket.AF_UNIX) as conn:
                conn.connect(self.path)
                conn.sendall(json.dumps({'hello': nonce}).encode()+b'\n')
                reader = conn.makefile('rb')
                challenge = json.loads(reader.readline())['challenge']
                signature = hmac.new(self.auth, ('request\n' + nonce + '\n' + challenge + '\n' + body).encode(), hashlib.sha256).hexdigest()
                conn.sendall(json.dumps({'nonce':nonce, 'challenge':challenge, 'body':body, 'mac':signature}).encode()+b'\n')
                return reader.readline()
        self.assertEqual(json.loads(send())['outcome'], 'erased')
        self.assertTrue(self.server.close())
        self.thread.join(2)
        self.registry.close()
        self.registry = NonceRegistry(os.path.join(self.directory.name, 'nonces.sqlite'), self.auth)
        self.server = GatewayServer(self.path, erase=self.deleted.append, dispatch=lambda _: None,
            allowed_pids={os.getpid()}, auth_key=self.auth, nonce_registry=self.registry)
        self.thread = threading.Thread(target=self.server.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.server.ready.wait(2))
        self.assertEqual(send(), b'')
        self.assertEqual(len(self.deleted), 1)

    def test_revoke_user_and_global_stop_are_acknowledged_after_callbacks(self):
        token = 'ab' * 32
        stopped = []
        self.server.stop_all = lambda: stopped.append(True)
        self.assertEqual(self.request({'op': 'revoke_user', 'subject': token}), {'outcome': 'erased'})
        self.assertEqual(self.request({'op': 'stop_all'}), {'outcome': 'stopped'})
        self.assertEqual(self.deleted, [bytes.fromhex(token)])
        self.assertEqual(stopped, [True])

    def test_user_revocation_and_global_stop_are_persisted_via_ipc(self):
        store_path = os.path.join(self.directory.name, 'state')
        os.mkdir(store_path, 0o700)
        state = DurableState(store_path, synthetic_fresh_start=True)
        self.server.erase = state.delete
        self.server.stop_all = state.stop_all
        user = '12345678-abcd-4abc-8abc-123456789abc'
        token = user_token(b'k' * 32, user)
        self.assertEqual(self.request({'op': 'revoke_user', 'subject': token.hex()}), {'outcome': 'erased'})
        self.assertEqual(self.request({'op': 'stop_all'}), {'outcome': 'stopped'})
        self.assertFalse(state.begin_attempt(token, lambda: self.fail('sent')))
        state.close()
        with open(os.path.join(store_path, 'gateway.log'), encoding='ascii') as log:
            contents = log.read()
        self.assertNotIn(user, contents)
        self.assertNotIn(token.hex(), contents)
        self.assertIn('"stopped":true', contents)
        state = DurableState(store_path)
        self.assertFalse(state.begin_attempt(token, lambda: self.fail('sent')))
        state.close()

    def test_deletion_routes_and_default_disabled_dispatch(self):
        token = 'ab' * 32
        self.assertEqual(self.request({'op': 'erase', 'subject': token}), {'outcome': 'erased'})
        self.assertEqual(self.deleted, [bytes.fromhex(token)])
        self.assertEqual(self.request({'op': 'dispatch', 'subject': token}), {'outcome': 'invalid'})
        self.assertEqual(self.sent, [])

    def test_erasure_is_durable_before_success(self):
        store_path = os.path.join(self.directory.name, 'state')
        os.mkdir(store_path, 0o700)
        store = DurableState(store_path)
        self.server.erase = store.delete
        token = 'cd' * 32
        self.assertEqual(self.request({'op': 'erase', 'subject': token}), {'outcome': 'erased'})
        store.close()
        with open(os.path.join(store_path, 'gateway.log'), encoding='ascii') as log:
            self.assertEqual(json.loads(log.readline()), {'deleted': hashlib.sha256(bytes.fromhex(token)).hexdigest()})
        reopened = DurableState(store_path)
        try:
            self.assertFalse(reopened.begin_attempt(bytes.fromhex(token), lambda: self.fail('sent')))
        finally:
            reopened.close()

    def test_hung_callback_does_not_block_other_connections(self):
        blocked = threading.Event()
        self.server.erase = lambda _: blocked.wait(2)
        try:
            self.assertEqual(self.request({'op': 'erase', 'subject': 'ab'*32}), {'outcome': 'unavailable'})
            self.assertEqual(self.request({'op': 'dispatch', 'subject': 'ab'*32}), {'outcome': 'invalid'})
        finally:
            blocked.set()

    def test_shutdown_reports_inflight_callback_and_closes_connections(self):
        blocked = threading.Event()
        entered = threading.Event()
        def hang(_):
            entered.set()
            blocked.wait(2)
        self.server.erase = hang
        def request_during_shutdown():
            try:
                self.request({'op': 'erase', 'subject': 'ab'*32})
            except (OSError, ValueError):
                pass
        requester = threading.Thread(target=request_during_shutdown, daemon=True)
        requester.start()
        self.assertTrue(entered.wait(1))
        self.assertFalse(self.server.close(timeout=0.05))
        blocked.set()
        requester.join(2)
        self.assertTrue(self.server.close(timeout=1))

    def test_slow_request_has_total_deadline(self):
        with socket.socket(socket.AF_UNIX) as conn:
            conn.settimeout(2)
            conn.connect(self.path)
            start = time.monotonic()
            try:
                while time.monotonic() - start < 1.5:
                    conn.sendall(b' ')
                    time.sleep(0.2)
            except (BrokenPipeError, ConnectionResetError):
                pass
            self.assertLess(time.monotonic() - start, 1.5)

    def test_rejects_unlisted_pid(self):
        self.server.allowed_pids = {os.getpid() + 1000000}
        with socket.socket(socket.AF_UNIX) as conn:
            conn.connect(self.path)
            self.assertEqual(conn.recv(1024), b'')

    def test_rejects_invalid_or_extra_input(self):
        for data in ({'op': 'erase', 'subject': 'a'}, {'op': 'erase', 'subject': 'ab'*32, 'contact': 'secret'}, {'op': 'unknown', 'subject': 'ab'*32}):
            self.assertEqual(self.request(data), {'outcome': 'invalid'})
        self.assertEqual(self.deleted, [])

    def test_callback_failure_is_fail_closed_and_not_exposed(self):
        def fail(_):
            raise RuntimeError('sensitive details')
        self.server.erase = fail
        self.assertEqual(self.request({'op': 'erase', 'subject': 'ab'*32}), {'outcome': 'unavailable'})

if __name__ == '__main__':
    unittest.main()
