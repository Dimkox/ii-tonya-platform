import unittest
import subprocess
import sys
from pathlib import Path

from egress_fence import render_rules


class EgressFenceTests(unittest.TestCase):
    def test_only_pinned_ipv4_and_port_are_permitted_for_dedicated_uid(self):
        rules = render_rules(12345, ['203.0.113.5', '203.0.113.7'], 443)
        self.assertIn('meta skuid 12345 ip daddr { 203.0.113.5, 203.0.113.7 } tcp dport 443 accept', rules)
        self.assertIn('meta skuid 12345 reject', rules)
        self.assertNotIn('ct state established', rules)

    def test_rejects_root_and_untrusted_values(self):
        for uid, ips, port in [(0, ['203.0.113.1'], 443), (-1, ['203.0.113.1'], 443), (1, [], 443), (1, ['::1'], 443), (1, ['1.2.3.4; flush ruleset'], 443), (1, ['1.2.3.4'], 0)]:
            with self.subTest(uid=uid, ips=ips, port=port):
                with self.assertRaises(ValueError):
                    render_rules(uid, ips, port)

    def test_direct_probe_fails_without_isolated_namespace(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('egress_fence.py')), '--probe-inner'],
            capture_output=True, text=True, timeout=5,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('distinct network namespace', result.stderr)
