import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
it("sends the exact request through authenticated Python IPC to a real local TLS peer", async () => {
  const address = `\0node-tls-${randomUUID()}`;
  const program = `
import json, os, sys, tempfile, threading
from unittest.mock import patch
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from nonce_registry import NonceRegistry
import test_gateway
p=tempfile.TemporaryDirectory(); state=os.path.join(p.name,'state'); os.mkdir(state,0o700)
test_gateway.HttpGatewayTests.setUpClass(); helper=test_gateway.HttpGatewayTests()
body=json.dumps({'id':'abc-123','status':'pending','confirmation':{'confirmation_url':'https://yoomoney.ru/checkout/test'}},separators=(',',':')).encode()
response=b'HTTP/1.1 200 OK\\r\\nContent-Length: '+str(len(body)).encode()+b'\\r\\n\\r\\n'+body
prepare,got,tls=helper.server(response=response)
class Authority:
 def claim(self,*args): return True
 def revoke(self,*args): return True
runtime=BoundGateway(state,synthetic_fresh_start=True,authority=Authority()); reg=NonceRegistry.initialize(os.path.join(p.name,'nonce.sqlite'),b'a'*32)
patcher=patch('bound_gateway.prepare_yookassa_tls',prepare);patcher.start()
server=runtime.create_ipc_server('\\0'+sys.argv[1],auth_key=b'a'*32,nonce_registry=reg,allowed_pids={os.getppid()},confirmation_hosts={'yoomoney.ru'},merchant_auth=('synthetic_shop_id','synthetic_secret'),subject_key=b'k'*32)
t=threading.Thread(target=server.serve,daemon=True);t.start()
if not server.ready.wait(3): sys.exit(2)
print('ready',flush=True)
sys.stdin.readline();tls.join(5);print('body:'+got[0].hex(),flush=True)
server.close();t.join(2);patcher.stop();reg.close();runtime.close();test_gateway.HttpGatewayTests.tearDownClass();p.cleanup()
`;
  const child = spawn("python3", ["-c", program, address.slice(1)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "",
    err = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("gateway startup timeout")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("gateway startup failed"));
      });
    });
    const client = new ExperimentalGatewayIpc({
      address,
      key: Buffer.alloc(32, "k"),
      authKey: Buffer.alloc(32, "a"),
      timeoutMs: 3000,
    });
    const body = Buffer.from('{"synthetic":"contact"}');
    const request = Buffer.concat([
      Buffer.from(
        `POST /v3/payments HTTP/1.1\r\nHost: api.yookassa.ru\r\nIdempotence-Key: 12345678-abcd-4abc-8abc-123456789abc\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      ),
      body,
    ]);
    const contactId = randomUUID(),
      idempotencyKey = "12345678-abcd-4abc-8abc-123456789abc";
    const attempt = createHash("sha256")
      .update(Buffer.from(idempotencyKey.replaceAll("-", ""), "hex"))
      .digest("hex");
    const context = {
      userId: randomUUID(),
      intentId: randomUUID(),
      contactId,
      idempotencyKey,
    };
    expect(await client.dispatch(contactId, attempt, request, context)).toEqual(
      {
        kind: "response",
        paymentId: "abc-123",
        paymentStatus: "pending",
        confirmationUrl: "https://yoomoney.ru/checkout/test",
      },
    );
    await client.revokeContact(contactId);
    expect(await client.dispatch(contactId, "b".repeat(64), request)).toEqual({
      kind: "unknown",
    });
    child.stdin.end("stop\n");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(err).toBe("");
    expect(output).toContain("body:" + body.toString("hex"));
  } finally {
    if (child.exitCode === null) {
      child.stdin.end("stop\n");
      child.kill();
    }
  }
}, 30000);
