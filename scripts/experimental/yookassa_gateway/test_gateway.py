import socket, ssl, tempfile, subprocess, threading, unittest
from pathlib import Path
from gateway import LocalHttpGateway

class HttpGatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.key=str(Path(cls.temp.name)/'k'); cls.cert=str(Path(cls.temp.name)/'c')
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',cls.key,'-out',cls.cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def server(self, hold_open=0, response=b'HTTP/1.1 200 OK\r\nContent-Length: 30\r\nConnection: close\r\n\r\n{\"id\":\"a1\",\"status\":\"pending\"}', disconnect=False):
        listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(); address=listener.getsockname(); got=[]
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(self.cert,self.key)
        def run():
            raw,_=listener.accept()
            with ctx.wrap_socket(raw,server_side=True) as conn:
                conn.settimeout(5); buffer=b''
                try:
                    while b'\r\n\r\n' not in buffer:
                        data=conn.recv(4096)
                        if not data: break
                        buffer+=data
                    if b'\r\n\r\n' in buffer:
                        header,body=buffer.split(b'\r\n\r\n',1)
                        length=int(next(x.split(b':',1)[1] for x in header.split(b'\r\n') if x.lower().startswith(b'content-length:')))
                        while len(body)<length:
                            data=conn.recv(4096)
                            if not data: break
                            body+=data
                        got.append(body)
                        if not disconnect:
                            conn.sendall(response)
                            if hold_open:
                                import time; time.sleep(hold_open)
                    else: got.append(b'')
                except (OSError,ssl.SSLError): got.append(b'error')
            listener.close()
        t=threading.Thread(target=run);t.start()
        def prepare():
            c=ssl.create_default_context(cafile=self.cert)
            return c.wrap_socket(socket.create_connection(address),server_hostname='localhost')
        return prepare,got,t
    @staticmethod
    def req(body): return b'POST /v3/payments HTTP/1.1\r\nHost: localhost\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n\r\n'+body
    def test_full_request_and_bounded_response(self):
        prepare,got,t=self.server(); gateway=LocalHttpGateway();gateway.arm_after_external_fencing();body=b'{"synthetic":"test"}'
        self.assertEqual(gateway.dispatch('user',prepare,self.req(body)),{'outcome':'response','http_status':200,'payment_id':'a1','payment_status':'pending'});t.join(5);self.assertEqual(got,[body])
    def test_keepalive_response_completes_without_waiting_for_close(self):
        import time
        prepare, got, t = self.server(hold_open=1)
        gateway = LocalHttpGateway(); gateway.arm_after_external_fencing(); start = time.monotonic()
        result = gateway.dispatch('user', prepare, self.req(b'x'), timeout=0.5)
        self.assertEqual(result['payment_status'], 'pending')
        self.assertLess(time.monotonic() - start, 0.5)
        t.join(3)

    def test_chunked_tls_response_is_read_once(self):
        body = b'{"id":"a1","status":"pending"}'
        response = b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' + format(len(body),'x').encode() + b'\r\n' + body + b'\r\n0\r\n\r\n'
        prepare, got, thread = self.server(response=response)
        gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        result = gateway.dispatch('user', prepare, self.req(b'x'))
        thread.join(3)
        self.assertEqual(result['payment_status'], 'pending')
        self.assertEqual(got, [b'x'])

    def test_deadline_after_admission_prevents_write(self):
        import time
        class Connection:
            calls = 0
            def setblocking(self, _): pass
            def send(self, _): self.calls += 1; return 1
            def close(self): pass
        conn = Connection(); gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user', lambda: conn, b'contact', before_admission=lambda: time.sleep(.02), timeout=.01), 'cancelled')
        self.assertEqual(conn.calls, 0)

    def test_contact_expires_during_admission_no_write(self):
        import time
        class Connection:
            calls = 0
            def setblocking(self, _): pass
            def send(self, _): self.calls += 1; return 1
            def close(self): pass
        conn = Connection(); gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user', lambda: conn, b'contact',
            before_admission=lambda: time.sleep(.03), not_after=time.time() + .01), 'cancelled')
        self.assertEqual(conn.calls, 0)

    def test_invalid_expiry_never_starts_network(self):
        gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        called = []
        self.assertEqual(gateway.dispatch('user', lambda: called.append(True), b'contact', not_after=float('nan')), 'cancelled')
        self.assertEqual(called, [])

    def test_delete_after_tls_handshake_before_request(self):
        prepare,got,t=self.server(); gateway=LocalHttpGateway();gateway.arm_after_external_fencing();ready=threading.Event();resume=threading.Event();out=[]
        worker=threading.Thread(target=lambda:out.append(gateway.dispatch('user',prepare,self.req(b'synthetic'),before_admission=lambda:(ready.set(),resume.wait()))));worker.start()
        self.assertTrue(ready.wait(5));gateway.delete('user',lambda:None);resume.set();worker.join(5);t.join(5)
        self.assertEqual(out,['cancelled']);self.assertEqual(got,[b''])
    def test_server_disconnect_after_request_is_unknown(self):
        prepare,got,t=self.server(disconnect=True);gateway=LocalHttpGateway();gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user',prepare,self.req(b'synthetic')),'unknown');t.join(5);self.assertEqual(got,[b'synthetic'])
    def test_oversized_response_is_unknown(self):
        prepare,got,t=self.server(response=b'HTTP/1.1 200 OK\r\n\r\n'+b'x'*1000);gateway=LocalHttpGateway();gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user',prepare,self.req(b'synthetic'),max_response=100),'unknown');t.join(5)
    def test_first_write_would_block_is_unknown_and_never_retried(self):
        class Blocked:
            calls=0
            def setblocking(self,_): pass
            def send(self,_): self.calls+=1;raise BlockingIOError()
            def close(self): pass
        conn=Blocked();gateway=LocalHttpGateway();gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user',lambda:conn,self.req(b'x')),'unknown');self.assertEqual(conn.calls,1)
class ResponseTests(unittest.TestCase):
    def test_rejects_ambiguous_or_incomplete_response(self):
        from gateway import parse_response
        for data in [b'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{}',
                     b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}',
                     b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\n{}',
                     b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nxx']:
            self.assertIsNone(parse_response(data))

    def test_failed_handshake_returns_unknown(self):
        gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        def fail(): raise ssl.SSLError('handshake failure')
        self.assertEqual(gateway.dispatch('user', fail, b'request'), 'unknown')

    def test_chunked_response_is_parsed_without_waiting_for_close(self):
        from gateway import parse_response
        data = b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' + b'1e\r\n{"id":"a1","status":"pending"}\r\n0\r\n\r\n'
        result = parse_response(data)
        self.assertEqual(result['payment_id'], 'a1')
        self.assertIsNone(parse_response(data.replace(b'Transfer-Encoding: chunked', b'Transfer-Encoding: chunked\r\nContent-Length: 30')))

    def test_non_2xx_cannot_confirm_success(self):
        from gateway import parse_response
        body = b'{"id":"a1","status":"succeeded"}'
        self.assertIsNone(parse_response(b'HTTP/1.1 500 Error\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body))

    def test_response_does_not_expose_canary_pii(self):
        import json
        from gateway import parse_response
        body = json.dumps({'id':'abc-123', 'status':'pending', 'customer':{'email':'canary@example.com'}, 'secret':'canary-secret'}).encode()
        response = b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body
        parsed = parse_response(response)
        self.assertEqual(parsed, {'outcome':'response','http_status':200,'payment_id':'abc-123','payment_status':'pending'})
        self.assertNotIn('canary', str(parsed))

    def test_partial_first_write_is_never_continued(self):
        class Partial:
            calls = 0
            def setblocking(self, _): pass
            def send(self, _): self.calls += 1; return 1
            def close(self): pass
        conn = Partial(); gateway = LocalHttpGateway(); gateway.arm_after_external_fencing()
        self.assertEqual(gateway.dispatch('user', lambda: conn, b'header\r\n\r\ncontact'), 'unknown')
        gateway.delete('user', lambda: None)
        self.assertEqual(conn.calls, 1)

class ExecutableTests(unittest.TestCase):
    def test_default_disabled_and_credentials_never_echoed(self):
        import os
        env = dict(os.environ)
        env.pop('YOO_EXPERIMENTAL_HTTPS_GATEWAY', None)
        result = subprocess.run(['python3', str(Path(__file__).with_name('gateway.py'))], input=b'{"secret":"synthetic-secret"}\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=5)
        self.assertEqual(result.stdout, b'{"outcome":"disabled"}\n')
        self.assertNotIn(b'synthetic-secret', result.stdout + result.stderr)

    def test_env_flag_cannot_enable_network(self):
        import json, os
        env = dict(os.environ, YOO_EXPERIMENTAL_HTTPS_GATEWAY='1')
        payload = {'origin':'https://api.yookassa.ru.evil.example', 'shop_id':'1', 'secret':'synthetic-secret', 'idempotency_key':'test', 'body':{}}
        result = subprocess.run(['python3', str(Path(__file__).with_name('gateway.py'))], input=(json.dumps(payload)+'\n').encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=5)
        self.assertEqual(result.stdout, b'{"outcome":"disabled"}\n')
        self.assertNotIn(b'synthetic-secret', result.stdout + result.stderr)

if __name__=='__main__': unittest.main()
