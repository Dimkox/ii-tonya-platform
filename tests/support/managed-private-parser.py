"""Test-only lifecycle: generate actual documents, then run the unchanged parser."""
import os
import subprocess
import sys

subprocess.run([
    sys.executable, "-I", "/app/make-parser-fixtures.py",
    "--output-dir", "/run/private-parser", "--font", "cjk",
], check=True, timeout=15)
os.execv(sys.executable, [
    sys.executable, "-I", "/app/socket_server.py", "/run/private-parser/s", sys.argv[1],
])
