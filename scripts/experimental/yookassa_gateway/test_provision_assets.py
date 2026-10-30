from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]


class ProvisionAssetsTests(unittest.TestCase):
    def test_provisioner_uses_only_two_exact_release_files(self):
        path = ROOT / "deploy/systemd/ii-tonya-yookassa-provision.service"
        text = path.read_text()
        self.assertIn("/usr/bin/systemd-sysusers /opt/ii-tonya-platform/current/gateway-provision/sysusers.conf", text)
        self.assertIn(
            "/usr/bin/systemd-tmpfiles --create /opt/ii-tonya-platform/current/gateway-provision/tmpfiles.conf", text
        )
        self.assertIn("TimeoutStartSec=30s", text)
        self.assertNotIn("[Install]", text)

    def test_private_directories_match_gateway_configuration(self):
        tmpfiles = (ROOT / "deploy/gateway-provision/tmpfiles.conf").read_text()
        self.assertIn("d /etc/ii-tonya-yookassa 0700 ii_tonya_gateway ii_tonya_gateway -", tmpfiles)
        self.assertIn("d /var/lib/ii-tonya-yookassa 0700 ii_tonya_gateway ii_tonya_gateway -", tmpfiles)
        unit = (ROOT / "deploy/systemd/ii-tonya-yookassa-gateway.service").read_text()
        self.assertIn("--config /etc/ii-tonya-yookassa/config.json", unit)
        self.assertIn("ReadWritePaths=/var/lib/ii-tonya-yookassa", unit)
