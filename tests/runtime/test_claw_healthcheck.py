import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ClawHealthcheckTests(unittest.TestCase):
    def test_node_major_check_executes_and_rejects_mismatch(self):
        lines = (ROOT / "deploy/claw/Dockerfile.test").read_text().splitlines()
        checks = [line for line in lines if line.startswith("HEALTHCHECK ")]
        self.assertEqual(len(checks), 1)
        cmd = json.loads(checks[0].split(" CMD ", 1)[1])
        self.assertEqual(cmd[:2], ["node", "-e"])
        good = subprocess.run(cmd, capture_output=True, timeout=5)
        self.assertEqual(good.returncode, 0)
        self.assertIn("=== '24'", cmd[2])
        cmd[2] = cmd[2].replace("=== '24'", "=== '0'")
        bad = subprocess.run(cmd, capture_output=True, timeout=5)
        self.assertNotEqual(bad.returncode, 0)
