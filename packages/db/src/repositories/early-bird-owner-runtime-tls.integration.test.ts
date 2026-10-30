import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { afterAll, expect, it, vi } from "vitest";
import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type DrizzleDb } from "../client.js";
import { startExpertReferralTestDatabase } from "../testkit/expert-referral.js";
import { startPublicExpertFuturePostgres } from "../../../../tests/support/public-expert-gateway-provider.mjs";
import { buildEarlyBirdRoleProvisioningSql } from "../../../../scripts/provision-early-bird-runtime-roles.mjs";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { createEarlyBirdOwnerRuntimeComposition } from "../../../../apps/api/src/expert-early-bird-runtime-composition.js";
import { PostgresPrivacyRepository } from "./privacy-repository.js";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { openEarlyBirdOwnerRequest } from "../../../integrations/src/yookassa/early-bird-sealed-request.js";

let f: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>> | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let clientContainer: string | undefined;
let temp: string | undefined;
const principalPools: DrizzleDb[] = [];
let database:
  Awaited<ReturnType<typeof startExpertReferralTestDatabase>> | undefined;
let clock:
  Awaited<ReturnType<typeof startPublicExpertFuturePostgres>> | undefined;
afterAll(async () => {
  if (child && child.exitCode === null) {
    child.stdin.end("stop\n");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child!.kill();
        resolve();
      }, 3000);
      child!.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await Promise.all(principalPools.map((db) => db.$client.end()));
  if (clientContainer)
    execFileSync("docker", ["rm", "-f", clientContainer], { stdio: "ignore" });
  if (temp) rmSync(temp, { recursive: true, force: true });
  try {
    await database?.stop();
  } finally {
    try {
      await clock?.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  }
}, 120000);

it("runs approved owner checkout through PG admission, authenticated IPC, real TLS, binding recovery and acknowledged contact revocation", async () => {
  clock = await startPublicExpertFuturePostgres();
  await clock.advance(
    (Date.parse("2026-11-02T12:00:00Z") - Date.parse("2027-01-11T12:00:00Z")) /
      1000,
  );
  const NativeDate = Date;
  vi.stubGlobal(
    "Date",
    new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(
          target,
          args.length ? args : [NativeDate.now() + clock!.offsetSeconds * 1000],
        );
      },
      get(target, property) {
        return property === "now"
          ? () => NativeDate.now() + clock!.offsetSeconds * 1000
          : Reflect.get(target, property);
      },
    }),
  );
  const previousAdmin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
  try {
    database = await startExpertReferralTestDatabase();
  } finally {
    if (previousAdmin === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previousAdmin;
  }
  f = await createEarlyBirdOwnerJourney({ database });
  const db = f.db.db;
  expect(
    Math.abs(
      Number(
        (
          await db.$client.query(
            "select extract(epoch from clock_timestamp())*1000 n",
          )
        ).rows[0]!.n,
      ) - Date.now(),
    ),
  ).toBeLessThan(1500);
  for (const file of [
    "0082_early_bird_settlement.sql",
    "0083_early_bird_verified_settlement.sql",
    "0084_early_bird_verified_payment_reader.sql",
    "0085_early_bird_verified_refund_settlement.sql",
    "0086_early_bird_verified_refund_binding.sql",
    "0088_early_bird_deferred_payments.sql",
    "0089_early_bird_deferred_refunds.sql",
    "early_bird_owner_send_capability.sql",
    "receipt_revocation_outbox.sql",
    "early_bird_gateway_authority.sql",
  ])
    await applyEarlyBirdDraftIfNeeded(
      db,
      "docs/superpowers/implementation-artifacts/drafts/" + file,
    );
  await db.execute(
    sql`DO $$ DECLARE p record; BEGIN FOR p IN SELECT oid::regprocedure as fn FROM pg_proc WHERE prosecdef AND pronamespace IN(SELECT oid FROM pg_namespace WHERE nspname in('public','early_bird_private')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',p.fn); END LOOP; END $$`,
  );
  const roles = {
    ii_tonya_wave_sender: "runtime_send",
    ii_tonya_wave_intent_reader: "runtime_candidate",
    ii_tonya_wave_verifier: "runtime_binding",
    ii_tonya_wave_verified_payment_reader: "runtime_known",
    ii_tonya_wave_gateway: "runtime_gateway",
  };
  const connections: Record<string, DrizzleDb> = {};
  const gatewayPassword = randomBytes(24).toString("hex");
  for (const login of Object.values(roles))
    await db.execute(
      sql.raw(
        `CREATE ROLE ${login} LOGIN INHERIT PASSWORD '${gatewayPassword}'`,
      ),
    );
  await db.execute(sql.raw(await buildEarlyBirdRoleProvisioningSql(roles)));
  for (const login of Object.values(roles)) {
    const url = new URL(db.$client.options.connectionString!);
    url.username = login;
    url.password = gatewayPassword;
    const connection = createDb(url.toString(), { max: 1 });
    principalPools.push(connection);
    connections[login] = connection;
    expect(
      (
        await connection.$client.query(
          "select session_user as login,current_user as effective",
        )
      ).rows[0],
    ).toEqual({ login, effective: login });
  }
  const readinessSQL = readFileSync(
    "scripts/experimental/yookassa_gateway/readiness.sql",
    "utf8",
  );
  const readyClient = await connections.runtime_gateway!.$client.connect();
  try {
    const ready = (await readyClient.query(readinessSQL)).rows[0];
    if (ready?.exists !== true) {
      const diagnostics = (
        await readyClient.query(`select jsonb_build_object(
        'login', jsonb_build_object('name',l.rolname,'login',l.rolcanlogin,'super',l.rolsuper,'createdb',l.rolcreatedb,'createrole',l.rolcreaterole,'replication',l.rolreplication,'bypass',l.rolbypassrls),
        'cap',jsonb_build_object('login',c.rolcanlogin,'inherit',c.rolinherit,'super',c.rolsuper),
        'membership',(select jsonb_agg(jsonb_build_object('member',member::regrole::text,'role',roleid::regrole::text,'admin',admin_option)) from pg_auth_members where member in(l.oid,c.oid) or roleid=c.oid),
        'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid::regprocedure::text,'definer',p.prosecdef,'owner',p.proowner::regrole::text,'settings',p.proconfig,'public',has_function_privilege('public',p.oid,'EXECUTE'),'login',has_function_privilege(l.oid,p.oid,'EXECUTE'))) from pg_proc p where p.oid in('public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)'::regprocedure,'public.early_bird_gateway_revoke(uuid)'::regprocedure,'public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)'::regprocedure)),
        'dbcreate',has_database_privilege(l.oid,current_database(),'CREATE'),
        'publiccreate',has_schema_privilege('public','public','CREATE'),
        'schemaaccess',(select jsonb_agg(nspname) from pg_namespace n where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and (has_schema_privilege(l.oid,n.oid,'CREATE') or has_schema_privilege(c.oid,n.oid,'CREATE'))),
        'tableaccess',(select jsonb_agg(n.nspname||'.'||t.relname) from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and t.relkind in('r','p','v','m','f') and (pg_has_role(l.oid,t.relowner,'MEMBER') or pg_has_role(c.oid,t.relowner,'MEMBER') or has_table_privilege(l.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege(c.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(l.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege(c.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES'))),
        'extraFunctions',(select jsonb_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and p.oid not in('public.early_bird_gateway_claim(uuid,uuid,uuid,uuid,text)'::regprocedure,'public.early_bird_gateway_revoke(uuid)'::regprocedure,'public.public_expert_gateway_claim(uuid,uuid,uuid,uuid,text,text)'::regprocedure) and p.prosecdef and (has_function_privilege(l.oid,p.oid,'EXECUTE') or has_function_privilege(c.oid,p.oid,'EXECUTE')))
      ) as checks from pg_roles l,pg_roles c where l.rolname=session_user and c.rolname='ii_tonya_wave_gateway'`)
      ).rows[0];
      throw new Error(
        "gateway_readiness_diagnostics:" + JSON.stringify(diagnostics),
      );
    }
  } finally {
    readyClient.release();
  }
  temp = mkdtempSync(join(tmpdir(), "early-bird-runtime-tls-"));
  const url = new URL(
    (db.$client as unknown as { options: { connectionString: string } }).options
      .connectionString,
  );
  writeFileSync(
    join(temp, "service"),
    `[fixture]\nhost=${url.hostname}\nport=${url.port}\ndbname=${url.pathname.slice(1)}\nuser=runtime_gateway\nconnect_timeout=3\noptions=-c statement_timeout=3000 -c lock_timeout=1500\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(temp, "pass"),
    `${url.hostname}:${url.port}:${url.pathname.slice(1)}:runtime_gateway:${gatewayPassword}\n`,
    { mode: 0o600 },
  );
  clientContainer = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--network=host",
      "--mount",
      `type=bind,src=${temp},dst=${temp},readonly`,
      "postgres:17.5-bookworm",
      "sleep",
      "infinity",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!/^[a-f0-9]{64}$/u.test(clientContainer))
    throw new Error("invalid test container");
  const wrapper = join(temp, "psql");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/docker exec -i -e PGSERVICE -e PGSERVICEFILE -e PGPASSFILE ${clientContainer} /usr/bin/psql "$@"\n`,
    { mode: 0o700 },
  );
  const readinessOutput = execFileSync(
    wrapper,
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    {
      input: readinessSQL,
      env: {
        PGSERVICE: "fixture",
        PGSERVICEFILE: join(temp, "service"),
        PGPASSFILE: join(temp, "pass"),
        PGCONNECT_TIMEOUT: "3",
      },
      encoding: "utf8",
    },
  );
  expect(readinessOutput).toBe("t\n");
  const address = "\0runtime-checkout-" + randomUUID();
  const program = String.raw`
import sys,json,os,tempfile,threading,ssl,socket,http.server,http.client,datetime
from unittest.mock import patch
sys.path.insert(0,'scripts/experimental/yookassa_gateway')
from bound_gateway import BoundGateway
from durable_state import DurableState
from nonce_registry import NonceRegistry
from pg_authority import PgAuthority
import test_gateway
base=sys.argv[1]; address='\0'+sys.argv[2]; offset=float(sys.argv[3])
test_gateway.HttpGatewayTests.setUpClass()
helper=test_gateway.HttpGatewayTests
payments={}; post_count=0
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def respond(self,data):
  body=json.dumps(data,separators=(',',':')).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  global post_count
  if self.path!='/v3/payments' or self.headers.get('Authorization')!='Basic MTIzOmZpeHR1cmUtc2VjcmV0':self.send_error(403);return
  command=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if command['amount']!={'value':'30.00','currency':'RUB'} or len(command['receipt']['items'])!=2:self.send_error(400);return
  post_count+=1
  p={'id':'f0000000-0000-4000-8000-000000000001','status':'pending','paid':False,'refundable':False,'test':False,'amount':command['amount'],'metadata':command['metadata'],'created_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=offset)).isoformat(timespec='milliseconds').replace('+00:00','Z'),'confirmation':{'type':'redirect','confirmation_url':'https://yoomoney.ru/checkout/fixture'}}
  payments[p['id']]=p;self.respond(p)
 def do_GET(self):
  if self.headers.get('Authorization')!='Basic MTIzOmZpeHR1cmUtc2VjcmV0':self.send_error(403);return
  if self.path.startswith('/v3/payments?'):self.respond({'items':list(payments.values())});return
  p=payments.get(self.path.rsplit('/',1)[-1])
  if p is None:self.send_error(404);return
  self.respond(p)
httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(helper.cert,helper.key);httpd.socket=ctx.wrap_socket(httpd.socket,server_side=True)
httpthread=threading.Thread(target=httpd.serve_forever,daemon=True);httpthread.start()
client_ctx=ssl.create_default_context(cafile=helper.cert)
port=httpd.server_address[1]
def prepare():return client_ctx.wrap_socket(socket.create_connection(('127.0.0.1',port),timeout=3),server_hostname='localhost')
original_https=http.client.HTTPSConnection
def reader_connection(*args,**kwargs):return original_https('localhost',port,timeout=3,context=client_ctx)
from provider_reader import ProviderReader as OriginalProviderReader
def local_provider_reader(merchant_auth,**options):return OriginalProviderReader(merchant_auth,factory=reader_connection,**options)
state=os.path.join(base,'state');os.mkdir(state,0o700)
initial=DurableState(state);initial.close()
authority=PgAuthority(psql_path=os.path.join(base,'psql'),service='fixture',service_file=os.path.join(base,'service'),pass_file=os.path.join(base,'pass'),timeout=8)
runtime=BoundGateway(state,authority=authority,require_existing=True)
if not runtime.resume_from_authority():raise RuntimeError('gateway authority readiness failed')
registry=NonceRegistry.initialize(os.path.join(base,'nonce'),b'a'*32)
with patch('bound_gateway.prepare_yookassa_tls',prepare),patch('provider_reader.ProviderReader',local_provider_reader):
 server=runtime.create_ipc_server(address,auth_key=b'a'*32,nonce_registry=registry,allowed_pids={os.getppid()},confirmation_hosts={'yoomoney.ru'},merchant_auth=('123','fixture-secret'),subject_key=b'k'*32)
 thread=threading.Thread(target=server.serve,daemon=True);thread.start()
 if not server.ready.wait(3):raise RuntimeError('IPC startup failed')
 print(json.dumps({'ready':True}),flush=True)
 for line in sys.stdin:
  if line.strip()=='stats':print(json.dumps({'posts':post_count}),flush=True)
  elif line.strip()=='stop':break
 server.close();thread.join(3)
registry.close();runtime.close();httpd.shutdown();httpd.server_close();test_gateway.HttpGatewayTests.tearDownClass()
`;
  child = spawn(
    "python3",
    ["-c", program, temp, address.slice(1), String(clock.offsetSeconds)],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  let buffer = "";
  const lines: string[] = [];
  let receive: ((line: string) => void) | undefined;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (receive) {
        const handler = receive;
        receive = undefined;
        handler(line);
      } else lines.push(line);
    }
  });
  const nextLine = () =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const line = lines.shift();
      if (line) return resolve(JSON.parse(line));
      const timer = setTimeout(() => {
        receive = undefined;
        reject(new Error("fixture gateway timeout: " + stderr));
      }, 15000);
      receive = (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      };
    });
  expect(await nextLine()).toEqual({ ready: true });
  const gateway = new ExperimentalGatewayIpc({
    address,
    key: Buffer.alloc(32, "k"),
    authKey: Buffer.alloc(32, "a"),
    timeoutMs: 10000,
  });
  const diagnostics: unknown[] = [];
  const runtime = createEarlyBirdOwnerRuntimeComposition(db, {
    checkout: {
      policy: {
        botId: "1",
        botKey: "fixture-bot",
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
      identityKey: Buffer.alloc(32, 7),
      requestKey: f.key,
      requestKeyReference: "vault:fixture",
      receiptVault: f.vault,
      returnUrl: f.receipt.returnUrl,
      onboardingFiscal: f.fiscal,
      subscriptionFiscal: f.fiscal,
    },
    gateway,
    gatewaySubjectKeyVersion: "fixture-v1",
    onDiagnostic: (event) => diagnostics.push(event),
    sender: { db: connections.runtime_send!, login: "runtime_send" },
    candidateReader: {
      db: connections.runtime_candidate!,
      login: "runtime_candidate",
    },
    bindingWriter: {
      db: connections.runtime_binding!,
      login: "runtime_binding",
    },
    knownBindingReader: {
      db: connections.runtime_known!,
      login: "runtime_known",
    },
  })!;
  const initial = await runtime.createOrRecover(f.scope);
  if (initial.kind !== "ready") {
    child.stdin.write("stats\n");
    const provider = await nextLine();
    const states = (
      await db.execute(
        sql`select i.status,(select count(*)::int from early_bird_gateway_claims c where c.intent_id=i.id) as claims,(select count(*)::int from early_bird_verified_bindings b where b.intent_id=i.id) as bindings,(select revoked_at is not null from early_bird_gateway_contact_state s where s.contact_id=${f.contact.id}::uuid) as revoked from early_bird_composite_intents i where i.id=${f.identity.operationId}::uuid`,
      )
    ).rows;
    throw new Error(
      "checkout_runtime_diagnostics:" +
        JSON.stringify({ result: initial.kind, provider, states, diagnostics }),
    );
  }
  expect(initial).toMatchObject({
    kind: "ready",
    confirmationUrl: "https://yoomoney.ru/checkout/fixture",
  });
  expect(
    (
      await db.execute(
        sql`select intent_id from early_bird_verified_bindings where intent_id=${f.identity.operationId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
  expect(await runtime.createOrRecover(f.scope)).toMatchObject({
    kind: "ready",
    confirmationUrl: "https://yoomoney.ru/checkout/fixture",
  });
  child.stdin.write("stats\n");
  expect(await nextLine()).toEqual({ posts: 1 });
  const privacy = new PostgresPrivacyRepository(db, {
    privacyMutationCapability: { enabled: true },
    beforePrivacyReceiptDisclosure: runtime.beforePrivacyReceiptDisclosure,
  });
  await privacy.withdrawConsentAtomically({
    targetUserId: f.user,
    purpose: "client_messaging",
    policyVersion: "client-messaging-v1",
    correlationId: randomUUID(),
  });
  expect(
    (
      await db.execute<{ decision: string }>(
        sql`select decision from consent_states where user_id=${f.user}::uuid and purpose='client_messaging'`,
      )
    ).rows[0]!.decision,
  ).toBe("revoked");
  expect(
    (
      await db.execute(
        sql`select contact_id from receipt_revocation_outbox where subject_id=${f.user}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.execute<{ revoked: boolean }>(
        sql`select revoked_at is not null as revoked from early_bird_gateway_contact_state where contact_id=${f.contact.id}::uuid`,
      )
    ).rows[0]!.revoked,
  ).toBe(true);
  expect(await runtime.createOrRecover(f.scope)).toEqual({
    kind: "unavailable",
  });
  // Even an authenticated caller attempting a fresh request after ACK is denied.
  const snapshot = (
    await db.execute<{
      ciphertext: string;
      keyReference: string;
      digest: string;
    }>(
      sql`select ciphertext,key_reference as "keyReference",request_digest as digest from early_bird_composite_requests where intent_id=${f.identity.operationId}::uuid`,
    )
  ).rows[0];
  if (snapshot) {
    const intent = (
      await db.execute<{ offer: string; expiry: string; launch: string }>(
        sql`select base_offer_shown_at::text as offer,expires_at::text as expiry,launch_at::text as launch from early_bird_composite_intents where id=${f.identity.operationId}::uuid`,
      )
    ).rows[0]!;
    const source = {
      ...f.receipt,
      intent: {
        ...f.identity,
        pricingPolicy: "owner_test_10_20_v1" as const,
        priceKind: "fixed_test" as const,
        mode: "live" as const,
        onboardingMinor: "1000" as const,
        subscriptionMinor: "2000" as const,
        totalMinor: "3000" as const,
        baseOfferShownAt: new Date(intent.offer).toISOString(),
        expiresAt: new Date(intent.expiry).toISOString(),
        launchAt: new Date(intent.launch).toISOString(),
      },
    };
    const body = openEarlyBirdOwnerRequest(source, snapshot, f.key).body;
    const nextId = randomUUID();
    const request = Buffer.from(
      `POST /v3/payments HTTP/1.1\r\nHost: api.yookassa.ru\r\nIdempotence-Key: ${nextId}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
    const denied = await gateway.dispatch(
      f.contact.id,
      createHash("sha256")
        .update(Buffer.from(nextId.replaceAll("-", ""), "hex"))
        .digest("hex"),
      request,
      {
        userId: f.user,
        intentId: f.identity.operationId,
        contactId: f.contact.id,
        idempotencyKey: nextId,
      },
    );
    expect(denied.kind).toBe("cancelled");
  }
  child.stdin.write("stats\n");
  expect(await nextLine()).toEqual({ posts: 1 });
  expect(stderr).toBe("");
}, 120000);
