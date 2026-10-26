"""Single-flight Unix-domain helper. AF_INET is disabled by its container runtime.
Socket permissions and SO_PEERCRED authenticate the configured worker UID. No secret
is passed to the parsing child. All document I/O is in pipes and bounded RAM.
"""
import json
import os
import socket
import socketserver
import struct
import subprocess
import sys

MAX_INPUT = 5 * 1024 * 1024

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(10)
        try:
            _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != int(sys.argv[2]):
                return
            header = self.rfile.readline(256)
            if not header.endswith(b'\n'):
                return
            meta = json.loads(header)
            if set(meta) != {'type', 'length', 'ocr'} or meta['type'] not in ('pdf', 'docx', 'jpeg', 'png') or type(meta['length']) is not int or not 0 < meta['length'] <= MAX_INPUT or type(meta['ocr']) is not bool:
                return
            data = self.rfile.read(meta['length'])
            if len(data) != meta['length']:
                return
            args = [sys.executable, '-I', '/app/helper.py', meta['type']]
            if meta['ocr']:
                args.append('ocr')
            result = subprocess.run(args, input=data, capture_output=True, timeout=9, env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8'})
            if result.returncode != 0 or result.stderr or len(result.stdout)>90000:
                self.wfile.write(b'null\n')
            else:
                self.wfile.write(result.stdout+b'\n')
        except Exception:
            try:
                self.wfile.write(b'null\n')
            except OSError:
                pass

class Server(socketserver.UnixStreamServer):
    request_queue_size = 1

if __name__ == '__main__':
    path = sys.argv[1]
    if os.path.exists(path):
        os.unlink(path)
    with Server(path, Handler) as server:
        os.chmod(path, 0o600)
        server.serve_forever()
