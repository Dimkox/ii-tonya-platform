import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
it("reads payment, refund, and list via authenticated Python gateway and real local TLS", async () => {
  const address = `\0reader-tls-${randomUUID()}`,
    program = `
import os,sys,tempfile,threading,json,ssl,http.server,http.client
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from nonce_registry import NonceRegistry
from provider_reader import ProviderReader
import test_gateway
p=tempfile.TemporaryDirectory();state=os.path.join(p.name,'state');os.mkdir(state,0o700)
test_gateway.HttpGatewayTests.setUpClass(); cert=test_gateway.HttpGatewayTests.cert;key=test_gateway.HttpGatewayTests.key
payment={'id':'pay1','status':'succeeded','paid':True,'test':False,'refundable':True,'confirmation':{'type':'redirect','confirmation_url':'https://yoomoney.ru/checkout/test'},'amount':{'value':'30.00','currency':'RUB'},'created_at':'2026-01-01T00:00:00Z','captured_at':'2026-01-02T00:00:00Z','metadata':{'order_id':'invoice','operation_id':'operation'}}
refund={'id':'ref1','payment_id':'pay1','status':'succeeded','amount':{'value':'10.00','currency':'RUB'},'created_at':'2026-01-03T00:00:00Z'}
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if self.headers.get('Authorization') != 'Basic c2hvcDpzZWNyZXQ=': self.send_error(403);return
  data=refund if self.path.startswith('/v3/refunds/') else ({'items':[payment]} if self.path.startswith('/v3/payments?') else payment)
  raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def log_message(self,*args): pass
httpd=http.server.HTTPServer(('127.0.0.1',0),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key);httpd.socket=ctx.wrap_socket(httpd.socket,server_side=True)
tls=threading.Thread(target=httpd.serve_forever,daemon=True);tls.start();port=httpd.server_port
runtime=BoundGateway(state,synthetic_fresh_start=True);reg=NonceRegistry.initialize(os.path.join(p.name,'nonce.sqlite'),b'a'*32)
server=runtime.create_ipc_server('\\0'+sys.argv[1],auth_key=b'a'*32,nonce_registry=reg,allowed_pids={os.getppid()},confirmation_hosts={'yoomoney.ru'},merchant_auth=('shop','secret'))
server.provider_reader=ProviderReader(('shop','secret'),factory=lambda:http.client.HTTPSConnection('localhost',port,context=ssl.create_default_context(cafile=cert)),confirmation_hosts={'yoomoney.ru'})
t=threading.Thread(target=server.serve,daemon=True);t.start()
if not server.ready.wait(3):sys.exit(2)
print('ready',flush=True);sys.stdin.readline();server.close();t.join(2);httpd.shutdown();tls.join(2);httpd.server_close();reg.close();runtime.close();test_gateway.HttpGatewayTests.tearDownClass();p.cleanup()
`;
  const child = spawn("python3", ["-c", program, address.slice(1)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("startup timeout")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("startup failed"));
      });
    });
    const client = new ExperimentalGatewayIpc({
      address,
      key: Buffer.alloc(32, "k"),
      authKey: Buffer.alloc(32, "a"),
      timeoutMs: 3000,
    });
    expect(await client.getPayment("pay1")).toMatchObject({
      id: "pay1",
      status: "succeeded",
      confirmation: {
        type: "redirect",
        url: "https://yoomoney.ru/checkout/test",
      },
    });
    expect(await client.getRefund("ref1")).toMatchObject({
      id: "ref1",
      paymentId: "pay1",
    });
    expect(
      await client.listPayments({
        createdFrom: "2026-01-01T00:00:00Z",
        createdTo: "2026-01-02T00:00:00Z",
        limit: 10,
      }),
    ).toMatchObject({
      items: [
        {
          id: "pay1",
          metadata: { order_id: "invoice", operation_id: "operation" },
        },
      ],
    });
    child.stdin.end("stop\n");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(err).toBe("");
  } finally {
    if (child.exitCode === null) {
      child.stdin.end("stop\n");
      child.kill();
    }
  }
}, 30000);
