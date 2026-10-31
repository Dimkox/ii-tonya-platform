import importlib.util
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "scripts/experimental/yookassa_gateway"))
spec = importlib.util.spec_from_file_location(
    "prepare_gateway_bad_marker", os.path.join(os.path.dirname(__file__), "prepare_gateway.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BadMarkerTest(unittest.TestCase):
    def test_non_root_marker_never_authorizes_initialization(self):
        if os.getuid() == 0:
            self.skipTest("requires non-root test user")
        with tempfile.TemporaryDirectory() as state:
            path = os.path.join(state, module.MARKER)
            with open(path, "wb") as output:
                output.write(b"test")
            os.chmod(path, 0o600)
            config = {
                "state_dir": state,
                "nonce_file": os.path.join(state, "nonce"),
                "auth_key_file": "a",
                "subject_key_file": "b",
            }
            with (
                patch.object(module, "read_secret", side_effect=lambda p: bytes([1 if p == "a" else 2]) * 32),
                patch.object(module, "initialize_state") as init,
            ):
                with self.assertRaises(ValueError):
                    module.prepare(config)
                init.assert_not_called()
                self.assertTrue(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
