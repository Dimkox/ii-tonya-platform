import importlib.util
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "scripts/experimental/yookassa_gateway"))
spec = importlib.util.spec_from_file_location(
    "prepare_gateway", os.path.join(os.path.dirname(__file__), "prepare_gateway.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = self.temp.name
        self.config = {
            "state_dir": self.state,
            "nonce_file": os.path.join(self.state, "nonce"),
            "pg_service_file": "service",
            "pg_pass_file": "pass",
            "pg_service": "synthetic",
            "auth_key_file": "key",
            "subject_key_file": "subject",
        }
        keys = patch.object(module, "read_secret", side_effect=lambda name: bytes([1 if name == "key" else 2]) * 32)
        keys.start()
        self.addCleanup(keys.stop)

    def tearDown(self):
        self.temp.cleanup()

    def marker(self):
        path = os.path.join(self.state, module.MARKER)
        with open(path, "wb") as out:
            out.write(b"authorize")
        os.chmod(path, 0o600)
        inode = os.stat(path).st_ino
        original = os.stat

        def fake(*args, **kwargs):
            info = original(*args, **kwargs)
            if info.st_ino != inode:
                return info
            values = list(info)
            values[4] = 0
            return os.stat_result(values)

        return patch.object(module.os, "stat", side_effect=fake)

    def test_partial_state_is_never_reset(self):
        with open(os.path.join(self.state, "gateway.lock"), "wb"):
            pass
        with (
            self.marker(),
            patch.object(module, "initialize_state") as state,
            patch.object(module, "initialize_nonce_registry") as nonce,
        ):
            with self.assertRaises(ValueError):
                module.prepare(self.config)
            state.assert_not_called()
            nonce.assert_not_called()
            self.assertTrue(os.path.exists(os.path.join(self.state, module.MARKER)))

    def test_pristine_marker_consumed_only_after_both_steps(self):
        with (
            self.marker(),
            patch.object(module, "initialize_state") as state,
            patch.object(module, "initialize_nonce_registry", side_effect=RuntimeError),
        ):
            with self.assertRaises(RuntimeError):
                module.prepare(self.config)
            state.assert_called_once()
            self.assertTrue(os.path.exists(os.path.join(self.state, module.MARKER)))
        with self.marker(), patch.object(module, "initialize_state"), patch.object(module, "initialize_nonce_registry"):
            module.prepare(self.config)
            self.assertFalse(os.path.exists(os.path.join(self.state, module.MARKER)))

    def test_missing_marker_never_initializes_missing_registry(self):
        with (
            patch.object(module, "private_file"),
            patch.object(module, "PgAuthority") as authority,
            patch.object(module, "NonceRegistry", side_effect=FileNotFoundError),
            patch.object(module, "initialize_state") as state,
        ):
            authority.return_value.check_readiness.return_value = True
            with self.assertRaises(FileNotFoundError):
                module.prepare(self.config)
            state.assert_not_called()


if __name__ == "__main__":
    unittest.main()
