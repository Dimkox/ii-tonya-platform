import json
import base64
import os
import socket
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import launcher


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.key = self.directory / "key"
        self.key.write_bytes(base64.urlsafe_b64encode(b"a" * 32).rstrip(b"="))
        self.key.chmod(0o600)
        self.subject_key = self.directory / "subject"
        self.subject_key.write_bytes(base64.urlsafe_b64encode(b"b" * 32).rstrip(b"="))
        self.subject_key.chmod(0o600)
        self.merchant = self.directory / "merchant"
        self.merchant.write_text("a" * 32)
        self.merchant.chmod(0o600)
        self.config = self.directory / "config"
        self.data = {
            "socket_name": "ii-tonya-test",
            "state_dir": str(self.directory),
            "nonce_file": str(self.directory / "nonce.db"),
            "auth_key_file": str(self.key),
            "allowed_pids": [os.getpid()],
            "allowed_uid": os.getuid() + 1,
            "confirmation_hosts": ["yoomoney.ru"],
            "pg_service": "gateway",
            "pg_service_file": str(self.key),
            "pg_pass_file": str(self.key),
            "subject_key_file": str(self.subject_key),
            "merchant_secret_file": str(self.merchant),
            "shop_id": "123",
        }
        self.config.write_text(json.dumps(self.data))
        self.config.chmod(0o600)

    def tearDown(self):
        self.tmp.cleanup()

    def test_canonical_key_matches_node_decode(self):
        self.key.write_bytes(base64.urlsafe_b64encode(bytes(range(32))).rstrip(b"=") + b"\n")
        code = "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8').trim();const b=Buffer.from(s,'base64url');if(b.length!==32||b.toString('base64url')!==s)process.exit(1);process.stdout.write(b.toString('hex'))"
        result = subprocess.run(
            ["node", "-e", code, str(self.key)], check=True, text=True, capture_output=True, timeout=5
        )
        self.assertEqual(launcher.read_secret(str(self.key)).hex(), result.stdout)

    def test_noncanonical_and_raw_keys_are_rejected(self):
        for data in (b"a" * 32, b"a" * 43 + b"=", b"a" * 42 + b"b", b" " + b"a" * 43, b"a" * 43 + b"\n\n"):
            self.key.write_bytes(data)
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    launcher.read_secret(str(self.key))

    def test_unknown_enable_option_and_provider_override_are_rejected(self):
        for name in ("enabled", "provider_host", "synthetic_fresh_start"):
            config = dict(self.data, **{name: True})
            self.config.write_text(json.dumps(config))
            with self.assertRaises(ValueError):
                launcher.load_config(str(self.config))

    def test_credential_symlink_or_insecure_mode_is_rejected(self):
        self.key.chmod(0o644)
        with self.assertRaises(ValueError):
            launcher.read_secret(str(self.key))
        self.key.chmod(0o600)
        link = self.directory / "link"
        link.symlink_to(self.key)
        with self.assertRaises(OSError):
            launcher.read_secret(str(link))

    def test_existing_state_and_database_authority_are_required_for_server(self):
        from nonce_registry import NonceRegistry

        registry = NonceRegistry.initialize(self.data["nonce_file"], b"a" * 32)
        registry.close()
        for name in ("gateway.lock", "gateway.log"):
            path = self.directory / name
            path.touch(mode=0o600)
        with (
            patch("pg_authority.PgAuthority.check_readiness", return_value=True),
            patch("bound_gateway.BoundGateway.create_ipc_server") as create,
        ):
            runtime, registry, server = launcher.build_server(launcher.load_config(str(self.config)))
            try:
                self.assertIs(server, create.return_value)
                self.assertEqual(create.call_args.kwargs["merchant_auth"], ("123", "a" * 32))
                self.assertEqual(create.call_args.kwargs["allowed_uid"], os.getuid() + 1)
            finally:
                registry.close()
                runtime.close()

    def test_real_ipc_server_receives_distinct_peer_identity(self):
        from nonce_registry import NonceRegistry

        registry = NonceRegistry.initialize(self.data["nonce_file"], b"a" * 32)
        registry.close()
        for name in ("gateway.lock", "gateway.log"):
            (self.directory / name).touch(mode=0o600)
        with patch("pg_authority.PgAuthority.check_readiness", return_value=True):
            runtime, registry, server = launcher.build_server(launcher.load_config(str(self.config)))
            try:
                self.assertEqual(server.allowed_uid, os.getuid() + 1)
                self.assertIn(os.getpid(), server.allowed_pids)
            finally:
                registry.close()
                runtime.close()

    def test_missing_database_authority_fails_before_server(self):
        from nonce_registry import NonceRegistry

        registry = NonceRegistry.initialize(self.data["nonce_file"], b"a" * 32)
        registry.close()
        with patch("pg_authority.PgAuthority.check_readiness", return_value=False):
            with self.assertRaises((RuntimeError, OSError)):
                launcher.build_server(launcher.load_config(str(self.config)))

    def test_explicit_state_initialization_never_overwrites(self):
        config = launcher.load_config(str(self.config))
        with patch("pg_authority.PgAuthority.check_readiness", return_value=True):
            launcher.initialize_state(config)
            with self.assertRaises(FileExistsError):
                launcher.initialize_state(config)
        self.assertEqual((self.directory / "gateway.log").read_bytes(), b"")

    def test_explicit_nonce_initialization_is_one_time_and_preserves_entries(self):
        config = launcher.load_config(str(self.config))
        launcher.initialize_nonce_registry(config)
        with self.assertRaises(FileExistsError):
            launcher.initialize_nonce_registry(config)
        from nonce_registry import NonceRegistry

        registry = NonceRegistry(self.data["nonce_file"], b"a" * 32)
        try:
            self.assertTrue(registry.consume("a" * 64))
            self.assertFalse(registry.consume("a" * 64))
        finally:
            registry.close()

    def test_uid_principal_without_pid_pin_is_explicit(self):
        self.data["allowed_pids"] = None
        self.config.write_text(json.dumps(self.data))
        self.assertIsNone(launcher.load_config(str(self.config))["allowed_pids"])
        self.data["allowed_pids"] = []
        self.config.write_text(json.dumps(self.data))
        with self.assertRaises(ValueError):
            launcher.load_config(str(self.config))

    def test_ready_notification_only_after_actual_ipc_bind(self):
        from nonce_registry import NonceRegistry

        registry = NonceRegistry.initialize(self.data["nonce_file"], b"a" * 32)
        registry.close()
        for name in ("gateway.lock", "gateway.log"):
            (self.directory / name).touch(mode=0o600)
        self.data["socket_name"] = "launcher-test-" + str(os.getpid())
        self.config.write_text(json.dumps(self.data))
        notify = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        notify.bind(str(self.directory / "notify"))
        notify.settimeout(3)
        env = dict(os.environ, NOTIFY_SOCKET=str(self.directory / "notify"))
        code = "import sys,pg_authority,launcher; pg_authority.PgAuthority.check_readiness=lambda self: True; sys.argv=['launcher','--config',sys.argv[1]]; sys.exit(launcher.main())"
        proc = subprocess.Popen(
            [sys.executable, "-c", code, str(self.config)], env=env, cwd=Path(__file__).resolve().parent
        )
        try:
            self.assertEqual(notify.recv(1024), b"READY=1")
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect("\0" + self.data["socket_name"])
        finally:
            proc.terminate()
            proc.wait(timeout=5)
            notify.close()

    def test_database_unavailable_never_notifies(self):
        from nonce_registry import NonceRegistry

        registry = NonceRegistry.initialize(self.data["nonce_file"], b"a" * 32)
        registry.close()
        for name in ("gateway.lock", "gateway.log"):
            (self.directory / name).touch(mode=0o600)
        notify = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        notify.bind(str(self.directory / "notify"))
        notify.settimeout(0.3)
        env = dict(os.environ, NOTIFY_SOCKET=str(self.directory / "notify"))
        code = "import sys,pg_authority,launcher; pg_authority.PgAuthority.check_readiness=lambda self: (sys.stderr.write('AUTHORITY_CHECK\\n'),False)[1]; sys.argv=['launcher','--config',sys.argv[1]]; sys.exit(launcher.main())"
        try:
            result = subprocess.run(
                [sys.executable, "-c", code, str(self.config)],
                env=env,
                capture_output=True,
                timeout=5,
                cwd=Path(__file__).resolve().parent,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"AUTHORITY_CHECK\n", result.stderr)
            self.assertIn(b"gateway unavailable: RuntimeError", result.stderr)
            with self.assertRaises(TimeoutError):
                notify.recv(1024)
        finally:
            notify.close()

    def test_invalid_configuration_never_notifies(self):
        notify = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        notify.bind(str(self.directory / "notify"))
        notify.settimeout(0.3)
        self.config.write_text("{}")
        env = dict(os.environ, NOTIFY_SOCKET=str(self.directory / "notify"))
        try:
            result = subprocess.run(
                [sys.executable, str(Path(launcher.__file__)), "--config", str(self.config)],
                env=env,
                capture_output=True,
                timeout=5,
            )
            self.assertNotEqual(result.returncode, 0)
            with self.assertRaises(TimeoutError):
                notify.recv(1024)
        finally:
            notify.close()

    def test_missing_nonce_registry_does_not_create_one(self):
        with self.assertRaises(Exception):
            launcher.build_server(launcher.load_config(str(self.config)))
        self.assertFalse(Path(self.data["nonce_file"]).exists())
