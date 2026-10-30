import { createServer, type Server } from "node:net";
import { randomUUID, createHmac } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  ExperimentalGatewayIpc,
  gatewayUserToken,
} from "./experimental-gateway-ipc.js";

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function listen(handler: (data: string) => string | null) {
  const address = `\0gateway-test-${randomUUID()}`;
  server = createServer((socket) => {
    const challenge = "b".repeat(64);
    let data = "",
      nonce = "",
      stage = "hello";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (!data.includes("\n")) return;
      if (stage === "hello") {
        nonce = (JSON.parse(data) as { hello: string }).hello;
        data = "";
        stage = "request";
        const mac = createHmac("sha256", authKey)
          .update(`hello\n${nonce}\n${challenge}`)
          .digest("hex");
        socket.write(JSON.stringify({ nonce, challenge, mac }) + "\n");
        return;
      }
      const response = handler(data);
      if (response !== null) socket.end(response);
    });
  });
  await new Promise<void>((resolve, reject) =>
    server!.listen(address, resolve).once("error", reject),
  );
  return address;
}
const user = "12345678-abcd-4abc-8abc-123456789abc";
const key = Buffer.alloc(32, "k");
const authKey = Buffer.alloc(32, "a");
it("matches Python canonical UUID HMAC token", () => {
  expect(gatewayUserToken(key, user)).toBe(
    "7c01d129585f901b7699fc4c88a2505fa33d8f54c0d9013a91a9e2edcb758c5a",
  );
  expect(gatewayUserToken(key, user.toUpperCase())).toBe(
    gatewayUserToken(key, user),
  );
  expect(() => gatewayUserToken(key, "person@example.com")).toThrow();
});
it("sends opaque user token and global stop over a real Unix socket", async () => {
  const commands: unknown[] = [];
  const address = await listen((data) => {
    const envelope = JSON.parse(data) as {
      nonce: string;
      challenge: string;
      body: string;
      mac: string;
    };
    expect(envelope.mac).toBe(
      createHmac("sha256", authKey)
        .update(
          `request\n${envelope.nonce}\n${envelope.challenge}\n${envelope.body}`,
        )
        .digest("hex"),
    );
    const command = JSON.parse(envelope.body) as { op: string };
    commands.push(command);
    const outcome = command.op === "revoke_user" ? "erased" : "stopped";
    const mac = createHmac("sha256", authKey)
      .update(`response\n${envelope.nonce}\n${envelope.challenge}\n${outcome}`)
      .digest("hex");
    return (
      JSON.stringify({
        outcome,
        nonce: envelope.nonce,
        challenge: envelope.challenge,
        mac,
      }) + "\n"
    );
  });
  const client = new ExperimentalGatewayIpc({
    address,
    key,
    authKey,
    timeoutMs: 200,
  });
  await client.revokeUser(user);
  await client.stopAll();
  expect(commands).toEqual([
    { op: "revoke_user", subject: gatewayUserToken(key, user) },
    { op: "stop_all" },
  ]);
  expect(JSON.stringify(commands)).not.toContain(user);
});
it("rejects extra fields or wrong acknowledgement", async () => {
  const address = await listen(() => '{"outcome":"erased","extra":1}\n');
  const client = new ExperimentalGatewayIpc({
    address,
    key,
    authKey,
    timeoutMs: 200,
  });
  await expect(client.revokeUser(user)).rejects.toThrow();
});
it("times out while peer is silent", async () => {
  const address = await listen(() => null);
  const client = new ExperimentalGatewayIpc({
    address,
    key,
    authKey,
    timeoutMs: 50,
  });
  await expect(client.stopAll()).rejects.toThrow();
});

it("authenticates with the Python gateway over an abstract Unix socket", async () => {
  const { spawn } = await import("node:child_process");
  const address = `\0cross-language-${randomUUID()}`;
  const program = `
import os, sys, threading, tempfile
sys.path.insert(0, 'scripts/experimental/yookassa_gateway')
from ipc import GatewayServer
from nonce_registry import NonceRegistry
tmp = tempfile.TemporaryDirectory()
registry = NonceRegistry.initialize(os.path.join(tmp.name, "nonces.sqlite"), b"a"*32)
address = '\\0' + sys.argv[1]
server = GatewayServer(address, erase=lambda _: None, stop_all=lambda: None,
    dispatch=lambda _: None, allowed_pids={os.getppid()}, auth_key=b'a'*32, nonce_registry=registry)
t = threading.Thread(target=server.serve, daemon=True)
t.start()
if not server.ready.wait(2): sys.exit(1)
print('ready', flush=True)
sys.stdin.readline()
server.close()
t.join(2)
registry.close()
tmp.cleanup()
`;
  const child = spawn("python3", ["-c", program, address.slice(1)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("gateway startup timeout")),
        2000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("gateway exited"));
      });
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const client = new ExperimentalGatewayIpc({
      address,
      key,
      authKey,
      timeoutMs: 500,
    });
    await client.revokeUser(user);
    await client.stopAll();
  } finally {
    child.stdin.end("stop\n");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
  }
});
