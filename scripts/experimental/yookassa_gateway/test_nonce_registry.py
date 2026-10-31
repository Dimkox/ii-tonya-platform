import os
import tempfile
import unittest
from nonce_registry import NonceRegistry


class NonceRegistryTests(unittest.TestCase):
    def test_consumed_nonce_survives_restart(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "nonces.sqlite")
            registry = NonceRegistry.initialize(path, b"a" * 32)
            self.assertTrue(registry.consume("ab" * 32))
            registry.close()
            registry = NonceRegistry(path, b"a" * 32)
            self.assertFalse(registry.consume("ab" * 32))
            self.assertTrue(registry.consume("cd" * 32))
            registry.close()

    def test_missing_or_wrong_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "nonces.sqlite")
            with self.assertRaises(FileNotFoundError):
                NonceRegistry(path, b"a" * 32)
            registry = NonceRegistry.initialize(path, b"a" * 32)
            registry.close()
            with self.assertRaises(ValueError):
                NonceRegistry(path, b"b" * 32)
            with self.assertRaises(FileExistsError):
                NonceRegistry.initialize(path, b"a" * 32)

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "nonces.sqlite")
            os.symlink(os.path.join(root, "other"), path)
            with self.assertRaises(OSError):
                NonceRegistry(path, b"a" * 32)
