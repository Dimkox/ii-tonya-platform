"""Fixture-level reader seam regression, not PostgreSQL journey acceptance.

Run only this new file. A child process executes the journey fixture's actual
reader setup against local TLS, real BoundGateway and real DurableState. Only
the unit authority snapshot is synthetic; no financial source is exercised.
Replacing the reader class with a factory function must break valid refunds.
"""

import ast
import base64
import copy
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from bound_gateway import BoundGateway
from provider_reader import ProviderReader as OriginalProviderReader
from test_public_dispatch import fixture, ORDER, USER, OPERATION
import test_gateway


ROOT = Path(__file__).resolve().parents[3]


def fixture_reader_setup(namespace):
    """Execute the actual nested gateway child's reader and its patch target."""
    source = (ROOT / "tests/support/public-expert-gateway-provider.mjs").read_text()
    outer = ast.parse(source.split("const program = String.raw`", 1)[1].split("`;", 1)[0])
    embedded = next(
        ast.literal_eval(node.value)
        for node in outer.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "gateway_program" for target in node.targets)
    )
    child = ast.parse(embedded)
    # Select the real constructor passed to the fixture's ProviderReader patch.
    reader_patch = next(
        item.context_expr
        for node in child.body
        if isinstance(node, ast.With)
        for item in node.items
        if isinstance(item.context_expr, ast.Call)
        and item.context_expr.args
        and isinstance(item.context_expr.args[0], ast.Constant)
        and item.context_expr.args[0].value == "provider_reader.ProviderReader"
    )
    constructor = reader_patch.args[1].id
    definitions = [
        node
        for node in child.body
        if (
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "original_https" for target in node.targets)
        )
        or isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ("connection", constructor)
    ]
    exec(compile(ast.Module(body=definitions, type_ignores=[]), "journey-child-reader", "exec"), namespace)
    return namespace[constructor], eval(compile(ast.Expression(reader_patch), "journey-reader-patch", "eval"), namespace)


def child_probe():
    test_gateway.HttpGatewayTests.setUpClass()
    certs = test_gateway.HttpGatewayTests
    parent = {
        "id": "a1", "status": "succeeded", "paid": True, "test": True,
        "amount": {"value": "3000.00", "currency": "RUB"},
        "created_at": "2026-10-30T00:00:00Z", "captured_at": "2026-10-30T00:01:00Z",
        "metadata": {"purpose": "main_residency", "operation_id": OPERATION, "order_id": ORDER, "user_id": USER},
    }
    posts, reads = [], []
    refund = {}
    expected_auth = "Basic " + base64.b64encode(b"1:synthetic").decode()

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def respond(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.headers.get("Authorization") != expected_auth:
                self.send_error(403)
                return
            reads.append(self.path)
            if self.path == "/v3/payments/a1":
                self.respond(parent)
            elif self.path == "/v3/refunds/b1":
                self.respond(refund)
            else:
                self.send_error(404)

        def do_POST(self):
            if self.headers.get("Authorization") != expected_auth or self.headers.get("Host") != "api.yookassa.ru":
                self.send_error(403)
                return
            body = self.rfile.read(int(self.headers["Content-Length"]))
            value = json.loads(body)
            posts.append({"path": self.path, "body": body.decode(), "key": self.headers.get("Idempotence-Key")})
            refund.update(id="b1", payment_id="a1", status="succeeded", amount=value["amount"],
                          metadata=value["metadata"], created_at="2026-10-30T00:02:00Z")
            self.respond(refund)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(certs.cert, certs.key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    client_ctx = ssl.create_default_context(cafile=certs.cert)
    port = server.server_address[1]
    namespace = {"OriginalProviderReader": OriginalProviderReader, "http": http, "client_ctx": client_ctx,
                 "port": port, "patch": patch}
    constructor, actual_patch = fixture_reader_setup(namespace)
    output = {"subclass": isinstance(constructor, type) and issubclass(constructor, OriginalProviderReader)}
    output["timestamp"] = constructor._timestamp("2026-10-30T00:00:00Z").isoformat() if hasattr(constructor, "_timestamp") else None

    def prepare():
        return client_ctx.wrap_socket(socket.create_connection(("127.0.0.1", port), timeout=3), server_hostname="localhost")

    try:
        with actual_patch:
            reader = constructor(("1", "synthetic"))
            # Constructor redirection must retain strict provider projection.
            valid_parent = copy.deepcopy(parent)
            for case in ("valid", "wrong_parent", "backward_capture"):
                parent.clear()
                parent.update(copy.deepcopy(valid_parent))
                if case == "wrong_parent":
                    parent["metadata"]["order_id"] = "wrong-order"
                if case == "backward_capture":
                    parent["captured_at"] = "2026-10-29T23:59:59Z"
                snapshot, body, claim = fixture("main_refund")
                calls = []
                authority = type("UnitAuthority", (), {"claim_public": lambda _self, *args: calls.append(args) or copy.deepcopy(snapshot)})()
                before = len(posts)
                with tempfile.TemporaryDirectory() as directory:
                    os.chmod(directory, 0o700)
                    gateway = BoundGateway(directory, synthetic_fresh_start=True, authority=authority)
                    attempt = hashlib.sha256(bytes.fromhex(snapshot["idempotencyKey"].replace("-", ""))).digest()
                    try:
                        try:
                            result = gateway.dispatch_public(b"s" * 32, attempt, prepare, body, claim,
                                                             merchant_auth=("1", "synthetic"), provider_reader=reader)
                        except Exception as error:
                            result = {"error": type(error).__name__}
                        replay = gateway.dispatch_public(b"s" * 32, attempt, prepare, body, claim,
                                                         merchant_auth=("1", "synthetic"), provider_reader=reader)
                    finally:
                        gateway.close()
                output[case] = {"result": result, "replay": replay, "writes": posts[before:], "claims": len(calls)}
            output["reads"] = reads
    finally:
        server.shutdown()
        server.server_close()
        thread.join(3)
        test_gateway.HttpGatewayTests.tearDownClass()
    print(json.dumps(output))


class JourneyReaderSeamTests(unittest.TestCase):
    def test_actual_child_reader_preserves_refund_validation_and_single_post(self):
        completed = subprocess.run([sys.executable, __file__, "--child"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["valid"]["result"], {
            "outcome": "response", "http_status": 200, "payment_id": "b1", "payment_status": "succeeded",
        }, result)
        self.assertTrue(result["subclass"])
        self.assertEqual(result["timestamp"], "2026-10-30T00:00:00+00:00")
        self.assertEqual(len(result["valid"]["writes"]), 1)
        self.assertEqual(result["valid"]["writes"][0]["path"], "/v3/refunds")
        self.assertEqual(result["valid"]["replay"], "cancelled")
        self.assertEqual(result["valid"]["claims"], 1)
        for case in ("wrong_parent", "backward_capture"):
            self.assertEqual(result[case]["result"], "unknown", result[case])
            self.assertEqual(result[case]["writes"], [])
            self.assertEqual(result[case]["replay"], "cancelled")
            self.assertEqual(result[case]["claims"], 1)
        self.assertIn("/v3/refunds/b1", result["reads"])
        self.assertGreaterEqual(result["reads"].count("/v3/payments/a1"), 4)


if __name__ == "__main__":
    if sys.argv[1:] == ["--child"]:
        child_probe()
    else:
        unittest.main()
