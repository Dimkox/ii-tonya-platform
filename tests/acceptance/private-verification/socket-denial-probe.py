import json
import socket

s = socket.socket(socket.AF_UNIX)
s.connect("/run/private-parser/parser.sock")
try:
    s.sendall(b'{"type":"pdf","length":1,"ocr":false}\nx')
    reply = s.recv(100)
    assert reply == b""
except (BrokenPipeError, ConnectionResetError):
    pass
finally:
    s.close()
print(json.dumps({"wrongPeerUidDenied": True}))
