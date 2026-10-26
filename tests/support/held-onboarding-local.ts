import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  createHeldOnboardingClient,
  type YooKassaReplayProtector,
  type YooKassaReplayDecryptor,
} from "@ii-tonya/integrations";
/** Real loopback HTTP + AES-GCM fixture, with no external provider or persistent key. */
export async function startHeldOnboardingLocal(paymentId = "sales_payment_1") {
  const requests: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  let state: "pending" | "waiting_for_capture" | "succeeded" | "canceled" =
    "pending";
  let metadata: Record<string, string> = {};
  let captureAt: string | undefined;
  let dropCreate = false;
  const createdAt = new Date().toISOString();
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    requests.push({ method: req.method!, path: req.url!, body });
    if (req.method === "POST" && req.url === "/v3/payments") {
      metadata = body.metadata as Record<string, string>;
      if (dropCreate) {
        req.socket.destroy();
        return;
      }
    }
    if (req.url?.endsWith("/capture")) {
      state = "succeeded";
      captureAt = new Date().toISOString();
    }
    if (req.url?.endsWith("/cancel")) state = "canceled";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: paymentId,
        status: state,
        paid: state === "waiting_for_capture" || state === "succeeded",
        amount: { value: "3000.00", currency: "RUB" },
        test: true,
        created_at: createdAt,
        ...(captureAt ? { captured_at: captureAt } : {}),
        metadata,
        payment_method: { type: "bank_card" },
        confirmation: {
          type: "redirect",
          confirmation_url: "https://yookassa.ru/synthetic-sales-checkout",
        },
        refundable: state === "succeeded",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture_address");
  const client = createHeldOnboardingClient(
    {
      enabled: true,
      mode: "test",
      shopId: "test-shop",
      secretKey: "synthetic-test-only",
    },
    (url, init) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init),
  );
  const key = randomBytes(32);
  const protector: YooKassaReplayProtector = {
    async protect(input) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      const bytes = Buffer.concat([
        cipher.update(input.body, "utf8"),
        cipher.final(),
      ]);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
          "base64url",
        ),
        keyReference: "synthetic-fixture-key",
        bodyVersion: 1,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    },
  };
  const decryptor: YooKassaReplayDecryptor = {
    async decrypt(input) {
      const bytes = Buffer.from(input.encryptedBody, "base64url"),
        cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(JSON.stringify(input.associatedData)));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return {
        body: Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString("utf8"),
        bodyVersion: 1,
      };
    },
  };
  return {
    client,
    protector,
    decryptor,
    requests,
    waiting() {
      state = "waiting_for_capture";
    },
    dropCreate() {
      dropCreate = true;
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
