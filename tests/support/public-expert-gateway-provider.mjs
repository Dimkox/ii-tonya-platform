import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// This is the ONLY destination seam: both gateway sockets verify a local TLS
// certificate. Production fixed-host transport and PgAuthority are unmodified.
const program = String.raw`
import sys,json,os,threading,ssl,socket,http.server,http.client
from unittest.mock import patch
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from durable_state import DurableState
from nonce_registry import NonceRegistry
from pg_authority import PgAuthority
from provider_reader import ProviderReader as OriginalProviderReader
import test_gateway
base=sys.argv[1]; address='\0'+sys.argv[2];offset=float(sys.argv[3])
test_gateway.HttpGatewayTests.setUpClass(); helper=test_gateway.HttpGatewayTests
payments={};refunds={};posts=[];reads=[];drop=False;block_after_drop=False;unavailable=False;paused=False
entered=threading.Event();release=threading.Event();lock=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def respond(self,data):
  body=json.dumps(data,separators=(',',':')).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def authenticated(self):return self.headers.get('Authorization')=='Basic MTIzOmZpeHR1cmUtc2VjcmV0'
 def do_POST(self):
  global drop,unavailable
  if not self.authenticated():self.send_error(403);return
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.headers.get('Host')!='api.yookassa.ru':self.send_error(400);return
  if paused:entered.set();release.wait(10)
  with lock:
   path=self.path; key=self.headers.get('Idempotence-Key')
   if any(p['key']==key for p in posts):self.send_error(409);return
   posts.append({'path':path,'key':key,'metadata':body.get('metadata'), 'hasReceipt':bool(body.get('receipt'))})
   now=(__import__('datetime').datetime.now(__import__('datetime').timezone.utc)+__import__('datetime').timedelta(seconds=offset)).isoformat(timespec='milliseconds').replace('+00:00','Z')
   if path=='/v3/payments':
    item={'id':str(__import__('uuid').uuid4()),'status':'pending','paid':False,'test':True,'refundable':False,'amount':body['amount'],'metadata':body['metadata'],'created_at':now,'confirmation':{'type':'redirect','confirmation_url':'https://yoomoney.ru/checkout/local'},'payment_method':{'type':'bank_card'}}
    payments[item['id']]=item
   elif path=='/v3/refunds':
    if body['payment_id'] not in payments:self.send_error(400);return
    item={'id':str(__import__('uuid').uuid4()),'payment_id':body['payment_id'],'status':'succeeded','amount':body['amount'],'metadata':body['metadata'],'created_at':now};refunds[item['id']]=item
   elif path.endswith('/capture') or path.endswith('/cancel'):
    item=payments[path.split('/')[3]];capture=path.endswith('/capture')
    if item['status']!='waiting_for_capture':self.send_error(409);return
    item.update(status='succeeded' if capture else 'canceled',paid=capture,refundable=capture)
    if capture:item['captured_at']=now
   else:self.send_error(404);return
   lose=drop;drop=False
   if lose:unavailable=block_after_drop
  if lose:self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);return
  self.respond(item)
 def do_GET(self):
  if not self.authenticated():self.send_error(403);return
  with lock:
   reads.append(self.path)
   if unavailable:self.send_error(503);return
   if self.path.startswith('/v3/payments?'):result={'items':list(payments.values())}
   elif self.path.startswith('/v3/refunds?'):result={'items':list(refunds.values())}
   elif self.path.startswith('/v3/payments/'):result=payments.get(self.path.rsplit('/',1)[-1])
   elif self.path.startswith('/v3/refunds/'):result=refunds.get(self.path.rsplit('/',1)[-1])
   else:result=None
  if result is None:self.send_error(404);return
  self.respond(result)
httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(helper.cert,helper.key);httpd.socket=ctx.wrap_socket(httpd.socket,server_side=True)
httpthread=threading.Thread(target=httpd.serve_forever,daemon=True);httpthread.start()
client_ctx=ssl.create_default_context(cafile=helper.cert);port=httpd.server_address[1]
def prepare():return client_ctx.wrap_socket(socket.create_connection(('127.0.0.1',port),timeout=3),server_hostname='localhost')
original_https=http.client.HTTPSConnection
def reader_connection(*args,**kwargs):return original_https('localhost',port,timeout=3,context=client_ctx)
def local_provider_reader(merchant_auth,**options):return OriginalProviderReader(merchant_auth,factory=reader_connection,**options)
state=os.path.join(base,'state');os.mkdir(state,0o700);initial=DurableState(state);initial.close()
gateway_program=r"""
import sys,os,json,threading,ssl,socket,http.client
from unittest.mock import patch
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from nonce_registry import NonceRegistry
from pg_authority import PgAuthority
from provider_reader import ProviderReader as OriginalProviderReader
base,address,port,cert,node_pid=sys.argv[1:];port=int(port);node_pid=int(node_pid)
client_ctx=ssl.create_default_context(cafile=cert)
def prepare():return client_ctx.wrap_socket(socket.create_connection(('127.0.0.1',port),timeout=3),server_hostname='localhost')
original_https=http.client.HTTPSConnection
def connection(*args,**kwargs):return original_https('localhost',port,timeout=3,context=client_ctx)
class LocalProviderReader(OriginalProviderReader):
 def __init__(self,merchant_auth,**options):super().__init__(merchant_auth,factory=connection,**options)
authority=PgAuthority(psql_path=os.path.join(base,'psql'),service='fixture',service_file=os.path.join(base,'service'),pass_file=os.path.join(base,'pass'),timeout=8)
runtime=BoundGateway(os.path.join(base,'state'),authority=authority,require_existing=True)
if not runtime.resume_from_authority():raise RuntimeError('authority readiness failed')
path=os.path.join(base,'nonce')
registry=NonceRegistry.initialize(path,b'a'*32) if not os.path.exists(path) else NonceRegistry(path,b'a'*32)
with patch('bound_gateway.prepare_yookassa_tls',prepare),patch('provider_reader.ProviderReader',LocalProviderReader):
 server=runtime.create_ipc_server('\0'+address,auth_key=b'a'*32,nonce_registry=registry,allowed_pids={node_pid},confirmation_hosts={'yoomoney.ru'},merchant_auth=('123','fixture-secret'),subject_key=b'k'*32)
 thread=threading.Thread(target=server.serve,daemon=True);thread.start()
 if not server.ready.wait(3):raise RuntimeError('IPC startup failed')
 print(json.dumps({'ready':True,'gatewayPid':os.getpid()}),flush=True)
 sys.stdin.readline();server.close();thread.join(3)
registry.close();runtime.close()
"""
import subprocess,select
def start_gateway_process():
 process=subprocess.Popen([sys.executable,'-c',gateway_program,base,sys.argv[2],str(port),helper.cert,str(os.getppid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
 if not select.select([process.stdout],[],[],10)[0]:process.kill();process.wait();raise RuntimeError('gateway child readiness timeout')
 line=process.stdout.readline()
 if not line or not json.loads(line).get('ready'):process.wait();raise RuntimeError('gateway child startup failed')
 return process
def stop_gateway_process(process):
 if process.poll() is None:
  process.stdin.write('stop\n');process.stdin.flush()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait();raise RuntimeError('gateway child shutdown timeout')
 if process.returncode!=0:raise RuntimeError('gateway child exited unsuccessfully')
 process.stdin.close();process.stdout.close()
process=start_gateway_process();print(json.dumps({'ready':True}),flush=True)
try:
 for line in sys.stdin:
  command=json.loads(line);op=command['op'];result={}
  if op=='stop':break
  elif op=='stats':result={'posts':posts,'reads':reads,'payments':list(payments.values()),'refunds':list(refunds.values()),'gatewayPid':process.pid}
  elif op=='offset':offset=command['seconds']
  elif op=='drop':drop=True;block_after_drop=command.get('unavailable',False)
  elif op=='reads':unavailable=not command['enabled']
  elif op=='pause':paused=True;entered.clear();release.clear()
  elif op=='entered':result={'entered':entered.wait(5)}
  elif op=='release':paused=False;release.set()
  elif op=='restart':stop_gateway_process(process);process=start_gateway_process();result={'ready':True,'gatewayPid':process.pid}
  elif op=='payment':
   item=payments[command['id']];status=command['status'];item.update(status=status,paid=status in ('waiting_for_capture','succeeded'),refundable=status=='succeeded')
   if status=='succeeded':item['captured_at']=command.get('capturedAt',(__import__('datetime').datetime.now(__import__('datetime').timezone.utc)+__import__('datetime').timedelta(seconds=offset)).isoformat(timespec='milliseconds').replace('+00:00','Z'))
  print(json.dumps(result),flush=True)
finally:
 release.set();stop_gateway_process(process)
httpd.shutdown();httpd.server_close();test_gateway.HttpGatewayTests.tearDownClass()
`;

/** Synthetic-only PG service files stay mode0600 and never enter argv/logs. */
export async function startPublicExpertGatewayProvider(
  connectionString,
  login,
  password,
  offsetSeconds,
) {
  const directory = await mkdtemp(join(tmpdir(), "public-expert-journey-"));
  const url = new URL(connectionString);
  await writeFile(
    join(directory, "service"),
    `[fixture]\nhost=${url.hostname}\nport=${url.port}\ndbname=${url.pathname.slice(1)}\nuser=${login}\nconnect_timeout=3\noptions=-c statement_timeout=3000 -c lock_timeout=1500\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "pass"),
    `${url.hostname}:${url.port}:${url.pathname.slice(1)}:${login}:${password}\n`,
    { mode: 0o600 },
  );
  let container;
  let child;
  try {
    container = execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--network=host",
        "--mount",
        `type=bind,src=${directory},dst=${directory},readonly`,
        "postgres:17.5-bookworm",
        "sleep",
        "infinity",
      ],
      { encoding: "utf8" },
    ).trim();
    if (!/^[a-f0-9]{64}$/u.test(container))
      throw Error("invalid test container");
    await writeFile(
      join(directory, "psql"),
      `#!/bin/sh\nexec /usr/bin/docker exec -i -e PGSERVICE -e PGSERVICEFILE -e PGPASSFILE ${container} /usr/bin/psql "$@"\n`,
      { mode: 0o700 },
    );
    const address = "\0public-expert-journey-" + randomUUID();
    child = spawn(
      "python3",
      ["-c", program, directory, address.slice(1), String(offsetSeconds)],
      { detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "",
      stderr = "";
    const lines = [],
      waiters = [];
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const resolve = waiters.shift();
        if (resolve) resolve(line);
        else lines.push(line);
      }
    });
    const next = () =>
      new Promise((resolve, reject) => {
        if (lines.length) return resolve(lines.shift());
        const done = (value) => {
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          reject(Error("local gateway timeout: " + stderr));
        }, 15000);
        waiters.push(done);
      });
    if (!(await next()).ready) throw Error("gateway not ready");
    return {
      address,
      async command(command) {
        child.stdin.write(JSON.stringify(command) + "\n");
        return next();
      },
      async close() {
        if (child.exitCode === null) {
          child.stdin.end('{"op":"stop"}\n');
          await new Promise((resolve) => {
            const timer = setTimeout(() => {
              process.kill(-child.pid, "SIGTERM");
              resolve();
            }, 10000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
        await rm(directory, { recursive: true, force: true });
        if (stderr) throw Error("local gateway stderr: " + stderr);
      },
    };
  } catch (error) {
    if (child?.pid && child.exitCode === null)
      process.kill(-child.pid, "SIGTERM");
    if (container)
      execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Isolated clock for unmodified clock_timestamp(), immutable Jan11 launch gates,
 * canonical quote deadlines, MFA and public coverage. No host clock is changed.
 * Debian package and official PG image are pinned; the generated image is local.
 */
export async function startPublicExpertFuturePostgres() {
  const directory = await mkdtemp(join(tmpdir(), "public-expert-pg-clock-"));
  const image = "ii-tonya-public-journey-clock:pg17.5-faketime0.9.10-2.1";
  const dockerfile = `FROM postgres:17.5-bookworm@sha256:fbcea1bd13b6a882cd6caa6b58db3ae5c102efe50ec625b3e2a5cbc50db5bfe4
RUN apt-get update -qq && apt-get install -y --no-install-recommends libfaketime=0.9.10-2.1 && rm -rf /var/lib/apt/lists/*
`;
  let container;
  try {
    await writeFile(join(directory, "Dockerfile"), dockerfile);
    execFileSync("docker", ["build", "-q", "-t", image, directory], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    let offsetSeconds = Math.ceil(
      (Date.parse("2027-01-11T12:00:00.000Z") - Date.now()) / 1000,
    );
    await (await import("node:fs/promises")).chmod(directory, 0o755);
    await writeFile(
      join(directory, "clock"),
      `${offsetSeconds >= 0 ? "+" : ""}${offsetSeconds}s`,
    );
    container = execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--mount",
        `type=bind,src=${directory},dst=/journey-clock,readonly`,
        "--user",
        "postgres",
        "-p",
        "127.0.0.1::5432",
        "-e",
        "POSTGRES_PASSWORD=synthetic-journey-only",
        "-e",
        "POSTGRES_USER=journey_admin",
        "-e",
        "POSTGRES_DB=journey",
        "-e",
        "LD_PRELOAD=/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1",
        "-e",
        "FAKETIME_TIMESTAMP_FILE=/journey-clock/clock",
        "-e",
        "FAKETIME_NO_CACHE=1",
        "-e",
        "DONT_FAKE_MONOTONIC=1",
        "-e",
        "FAKETIME_DONT_FAKE_MONOTONIC=1",
        image,
      ],
      { encoding: "utf8" },
    ).trim();
    const port = execFileSync(
      "docker",
      [
        "inspect",
        "--format",
        '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
        container,
      ],
      { encoding: "utf8" },
    ).trim();
    const connectionString = `postgresql://journey_admin:synthetic-journey-only@127.0.0.1:${port}/journey`;
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        execFileSync(
          "docker",
          [
            "exec",
            container,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "journey_admin",
            "-d",
            "journey",
          ],
          { stdio: "pipe" },
        );
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    const imageId = execFileSync(
      "docker",
      ["image", "inspect", image, "--format", "{{.Id}}"],
      { encoding: "utf8" },
    ).trim();
    return {
      connectionString,
      offsetSeconds,
      imageId,
      async advance(seconds) {
        offsetSeconds += seconds;
        this.offsetSeconds = offsetSeconds;
        await writeFile(
          join(directory, "clock"),
          `${offsetSeconds >= 0 ? "+" : ""}${offsetSeconds}s`,
        );
      },
      async stop() {
        execFileSync("docker", ["rm", "-fv", container], { stdio: "ignore" });
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (container)
      execFileSync("docker", ["rm", "-fv", container], { stdio: "ignore" });
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
