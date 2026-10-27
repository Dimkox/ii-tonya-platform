"""One bounded request at a time over an owned Unix socket; no network/downloader/logged input."""
import json, os, socketserver, signal
from engine import Engine
engine = Engine(os.environ['SEMANTIC_MODEL_PATH'])
cache = None
class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        global cache
        self.request.settimeout(5)
        signal.alarm(5)
        try:
            raw = self.rfile.readline(10_000_001)
            if len(raw) > 10_000_000 or not raw.endswith(b'\n'): raise ValueError('wire_bound')
            request = json.loads(raw)
            operation = request.get('operation')
            if operation == 'state':
                result = {'model': engine.model_identity, 'generation': cache['generation'] if cache else None}
            elif operation == 'prepare':
                prepared = engine.prepare(request['catalogue'])
                engine.load(prepared)
                cache = prepared
                result = prepared
            elif operation == 'restore':
                engine.load(request['cache'])
                cache = request['cache']
                result = {'generation': cache['generation']}
            elif operation == 'recommend' and cache and request['generation'] == cache['generation']:
                result = {'generation': cache['generation'], 'candidates': engine.recommend(request['text'], cache)}
            else: raise ValueError('generation_unavailable')
            self.wfile.write(json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False).encode() + b'\n')
        except Exception:
            self.wfile.write(b'{"ok":false,"error":"semantic_unavailable"}\n')
        finally:
            signal.alarm(0)
class Server(socketserver.UnixStreamServer):
    request_queue_size = 4
path = os.environ.get('SEMANTIC_SOCKET', '/run/semantic-tags/semantic.sock')
if os.path.exists(path): os.unlink(path)
os.umask(0o077)
with Server(path, Handler) as server: server.serve_forever()
