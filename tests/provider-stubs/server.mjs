import { createServer } from "node:http";

const host = process.env.PROVIDER_STUB_HOST ?? "0.0.0.0";
const port = Number(process.env.PROVIDER_STUB_PORT ?? "4010");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Invalid PROVIDER_STUB_PORT");
}

const records = [];
const fixtures = {
  selarti: {
    accepted: true,
    providerOperationId: "selarti-fixture-operation-1",
  },
  planerka: {
    applied: true,
    externalReservationId: "planerka-fixture-reservation-1",
  },
  telegram: { ok: true, result: { message_id: 42 } },
};
const credentialHeaders = new Set(["authorization", "cookie", "x-api-key"]);

const send = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const server = createServer(async (request, response) => {
  try {
    if (
      [...credentialHeaders].some((name) => request.headers[name] !== undefined)
    ) {
      send(response, 400, { error: "credentials_not_accepted" });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { status: "ready", fixtureOnly: true });
      return;
    }
    if (request.method === "GET" && request.url === "/records") {
      send(response, 200, { records });
      return;
    }
    const match = /^\/(selarti|planerka|telegram)\/events$/u.exec(
      request.url ?? "",
    );
    if (request.method !== "POST" || match === null) {
      send(response, 404, { error: "not_found" });
      return;
    }
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1) {
      send(response, 400, { error: "idempotency_key_required" });
      return;
    }
    const provider = match[1];
    const body = await readJson(request);
    records.push({
      provider,
      idempotencyKey,
      body,
      receivedAt: new Date().toISOString(),
    });
    send(response, 200, fixtures[provider]);
  } catch (error) {
    send(response, 400, {
      error: error instanceof Error ? error.message : "invalid_request",
    });
  }
});

server.listen(port, host);
const close = () => server.close(() => process.exit(0));
process.once("SIGTERM", close);
process.once("SIGINT", close);
