import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


def health_command(path):
    lines = (ROOT / path).read_text().splitlines()
    matches = [line for line in lines if line.startswith("HEALTHCHECK ")]
    if len(matches) != 1:
        raise AssertionError("exactly one healthcheck required")
    return json.loads(matches[0].split(" CMD ", 1)[1])


class HealthChecks(unittest.TestCase):
    def test_socket_health_and_missing_or_stale_socket(self):
        for path, is_semantic in [
            ("packages/integrations/parser/Dockerfile", False),
            ("runtime/semantic-tags/Dockerfile", True),
        ]:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as temp:
                sockpath = str(Path(temp) / "socket")
                cmd = health_command(path)
                self.assertEqual(cmd[0], "python")
                cmd[0] = sys.executable
                if not is_semantic:
                    cmd[-1] = cmd[-1].replace("/run/private-parser/parser.sock", sockpath)
                env = dict(os.environ, SEMANTIC_SOCKET=sockpath)
                self.assertNotEqual(subprocess.run(cmd, env=env, capture_output=True, timeout=5).returncode, 0)
                server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                server.bind(sockpath)
                server.listen(1)

                def handle():
                    conn, _ = server.accept()
                    with conn:
                        if is_semantic:
                            self.assertEqual(conn.recv(4096), b'{"operation":"state"}\n')
                            conn.sendall(b'{"ok":true,')
                            time.sleep(0.05)
                            conn.sendall(b'"result":{"model":"synthetic"}}\n')

                worker = threading.Thread(target=handle)
                worker.start()
                try:
                    self.assertEqual(subprocess.run(cmd, env=env, capture_output=True, timeout=5).returncode, 0)
                    worker.join(3)
                    self.assertFalse(worker.is_alive())
                finally:
                    server.close()
                self.assertNotEqual(subprocess.run(cmd, env=env, capture_output=True, timeout=5).returncode, 0)
