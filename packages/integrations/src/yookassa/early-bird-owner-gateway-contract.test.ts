import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import { EarlyBirdOwnerCheckoutSender } from "./early-bird-owner-checkout-sender.js";
import { sealEarlyBirdOwnerRequest } from "./early-bird-sealed-request.js";
import {
  YooKassaEarlyBirdCandidateVerifier,
  assertVerifiedEarlyBirdCandidate,
} from "./early-bird-candidate-verifier.js";

it("matches the owner sender contract through real IPC/TLS/GET and a branded candidate proof", async () => {
  const directory = mkdtempSync(join(tmpdir(), "owner-gateway-contract-"));
  const address = "\0owner-contract-" + randomUUID();
  // This isolates the transport/provider contract; PostgreSQL authorization and
  // admission are deliberate stubs here and are NOT proved by this test.
  const program = String.raw`
import sys,json,os,threading,ssl,socket,http.server,http.client
from unittest.mock import patch
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from nonce_registry import NonceRegistry
import test_gateway
base=sys.argv[1];address='\0'+sys.argv[2]
test_gateway.HttpGatewayTests.setUpClass();helper=test_gateway.HttpGatewayTests
payments={};posts=0
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def respond(self,data):
  body=json.dumps(data,separators=(',',':')).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  global posts
  if self.path!='/v3/payments' or self.headers.get('Authorization')!='Basic MTIzOmZpeHR1cmUtc2VjcmV0':self.send_error(403);return
  command=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if command['amount']!={'value':'30.00','currency':'RUB'} or len(command['receipt']['items'])!=2:self.send_error(400);return
  posts+=1
  p={'id':'f0000000-0000-4000-8000-000000000001','status':'pending','paid':False,'refundable':False,'test':False,'amount':command['amount'],'metadata':command['metadata'],'created_at':'2026-11-02T00:00:01.000Z','confirmation':{'type':'redirect','confirmation_url':'https://yoomoney.ru/checkout/fixture'}}
  payments[p['id']]=p;self.respond(p)
 def do_GET(self):
  if self.headers.get('Authorization')!='Basic MTIzOmZpeHR1cmUtc2VjcmV0':self.send_error(403);return
  p=payments.get(self.path.rsplit('/',1)[-1]);self.respond(p if p else {})
httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(helper.cert,helper.key);httpd.socket=ctx.wrap_socket(httpd.socket,server_side=True)
threading.Thread(target=httpd.serve_forever,daemon=True).start();port=httpd.server_address[1]
client_ctx=ssl.create_default_context(cafile=helper.cert)
def prepare():return client_ctx.wrap_socket(socket.create_connection(('127.0.0.1',port),timeout=3),server_hostname='localhost')
original_https=http.client.HTTPSConnection
def reader_connection(*args,**kwargs):return original_https('localhost',port,timeout=3,context=client_ctx)
from provider_reader import ProviderReader as OriginalProviderReader
def local_provider_reader(merchant_auth,**options):return OriginalProviderReader(merchant_auth,factory=reader_connection,**options)
class StubAuthority:
 def claim(self,*args):return True
 def revoke(self,*args):return True
state=os.path.join(base,'state');os.mkdir(state,0o700)
runtime=BoundGateway(state,synthetic_fresh_start=True,authority=StubAuthority())
registry=NonceRegistry.initialize(os.path.join(base,'nonce'),b'a'*32)
with patch('bound_gateway.prepare_yookassa_tls',prepare),patch('provider_reader.ProviderReader',local_provider_reader):
 server=runtime.create_ipc_server(address,auth_key=b'a'*32,nonce_registry=registry,allowed_pids={os.getppid()},confirmation_hosts={'yoomoney.ru'},merchant_auth=('123','fixture-secret'),subject_key=b'k'*32)
 thread=threading.Thread(target=server.serve,daemon=True);thread.start()
 if not server.ready.wait(3):raise RuntimeError('IPC startup failed')
 print('ready',flush=True)
 sys.stdin.readline()
 print(json.dumps({'posts':posts}),flush=True)
 server.close();thread.join(3)
registry.close();runtime.close();httpd.shutdown();httpd.server_close();test_gateway.HttpGatewayTests.tearDownClass()
`;
  const child = spawn("python3", ["-c", program, directory, address.slice(1)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "",
    output = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("gateway startup timeout:" + stderr)),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("gateway startup failed:" + stderr));
      });
    });
    const gateway = new ExperimentalGatewayIpc({
      address,
      key: Buffer.alloc(32, "k"),
      authKey: Buffer.alloc(32, "a"),
      timeoutMs: 10000,
    });
    const intent = {
      invoiceId: randomUUID(),
      userId: randomUUID(),
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      grantId: randomUUID(),
      pricingPolicy: "owner_test_10_20_v1" as const,
      priceKind: "fixed_test" as const,
      mode: "live" as const,
      onboardingMinor: "1000" as const,
      subscriptionMinor: "2000" as const,
      totalMinor: "3000" as const,
      baseOfferShownAt: "2026-11-01T21:00:00.000Z",
      expiresAt: "2026-11-11T21:00:00.000Z",
      launchAt: "2027-01-10T21:00:00.000Z",
    };
    const fiscal = {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    };
    const source = {
      intent,
      customer: { email: "fixture@example.invalid" },
      returnUrl: "https://example.invalid/return",
      onboardingFiscal: fiscal,
      subscriptionFiscal: fiscal,
    };
    const key = randomBytes(32),
      sealed = sealEarlyBirdOwnerRequest(source, key, "vault:fixture"),
      contactId = randomUUID();
    const verifier = new YooKassaEarlyBirdCandidateVerifier(gateway, {
      findIntent: async () => {
        const { idempotencyKey, ...snapshot } = intent;
        void idempotencyKey;
        return snapshot;
      },
    });
    let bound = 0;
    const diagnostics: unknown[] = [];
    const sender = new EarlyBirdOwnerCheckoutSender({
      enabled: true,
      gateway,
      verifier,
      client: gateway,
      binding: {
        async bind(proof) {
          assertVerifiedEarlyBirdCandidate(proof, verifier);
          bound++;
        },
      },
      resolveRequestKey: () => key,
      onDiagnostic: (event) => diagnostics.push(event),
      admission: {
        async admit(input, authenticate) {
          const body = authenticate({ intent, sealed });
          expect(
            `sha256:${createHash("sha256").update(body).digest("hex")}`,
          ).toBe(sealed.digest);
          return {
            kind: "initial_send_admitted",
            ...input,
            invoiceId: intent.invoiceId,
            idempotencyKey: intent.idempotencyKey,
            digest: sealed.digest,
            body,
          };
        },
      },
    });
    const result = await sender.createOrRecover({
      userId: intent.userId,
      operationId: intent.operationId,
      receiptContactId: contactId,
      source: {
        customer: source.customer,
        returnUrl: source.returnUrl,
        onboardingFiscal: fiscal,
        subscriptionFiscal: fiscal,
      },
    });
    if (result.kind !== "ready") {
      let readerResult: unknown, verifierResult: unknown;
      try {
        const observed = await gateway.getPayment(
          "f0000000-0000-4000-8000-000000000001",
        );
        readerResult = {
          status: observed.status,
          amount: observed.amount,
          createdAt: observed.createdAt,
          metadataKeys: Object.keys(observed.metadata),
          refundableType: typeof observed.refundable,
        };
      } catch (error) {
        readerResult =
          error instanceof Error ? error.message : "reader failure";
      }
      try {
        await verifier.verify(
          intent.operationId,
          "f0000000-0000-4000-8000-000000000001",
        );
        verifierResult = "verified";
      } catch (error) {
        verifierResult =
          error instanceof Error ? error.message : "verification failure";
      }
      throw new Error(
        "owner_gateway_contract_diagnostics:" +
          JSON.stringify({
            result,
            diagnostics,
            bound,
            readerResult,
            verifierResult,
          }),
      );
    }
    expect(result.confirmationUrl).toBe("https://yoomoney.ru/checkout/fixture");
    expect(bound).toBe(1);
    child.stdin.end("stop\n");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(stderr).toBe("");
    expect(output).toContain('"posts": 1');
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
