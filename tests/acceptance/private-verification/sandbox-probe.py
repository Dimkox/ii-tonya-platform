import errno
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

checks = {
    "uid": os.getuid(),
    "memoryMax": Path("/sys/fs/cgroup/memory.max").read_text().strip(),
    "pidsMax": Path("/sys/fs/cgroup/pids.max").read_text().strip(),
    "cpuMax": Path("/sys/fs/cgroup/cpu.max").read_text().strip(),
}
try:
    Path("/app/forbidden-write").write_bytes(b"synthetic")
    checks["readonly"] = False
except OSError as e:
    checks["readonly"] = e.errno in (errno.EROFS, errno.EACCES)
checks["hostFileHidden"] = not Path("/home/pall/.codex").exists()
s = socket.socket()
s.settimeout(1)
checks["networkBlocked"] = s.connect_ex(("1.1.1.1", 443)) != 0
s.close()
children = []
try:
    for _ in range(20):
        children.append(
            subprocess.Popen(
                [sys.executable, "-c", "import time;time.sleep(5)"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
    checks["pidsBound"] = False
except OSError as e:
    checks["pidsBound"] = e.errno == errno.EAGAIN
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
for name, body in [("memory", "return bytearray(400*1024*1024)"), ("cpu", "while True: pass")]:
    code = (
        "import sys;sys.path.insert(0,'/app');import helper\ndef probe(data,kind):\n    "
        + body
        + "\nhelper.extract=probe\nsys.argv=['helper','pdf']\nhelper.main()"
    )
    r = subprocess.run([sys.executable, "-I", "-c", code], input=b"x", capture_output=True, timeout=6)
    checks[name + "Bound"] = (
        r.returncode == 0 and r.stdout == b"null" if name == "memory" else r.returncode in (-9, -24)
    )
assert (
    checks["uid"] == 1000
    and checks["memoryMax"] == str(384 * 1024 * 1024)
    and checks["pidsMax"] == "16"
    and checks["cpuMax"] == "100000 100000"
)
assert all(checks[k] for k in ["readonly", "hostFileHidden", "networkBlocked", "pidsBound", "memoryBound", "cpuBound"])
print(json.dumps(checks))
