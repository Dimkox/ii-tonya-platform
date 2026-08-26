import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("client conversation runtime fixture boundary", () => {
  it("keeps fixture authentication and normalized header authority out of production composition", () => {
    const route = read("apps/api/src/routes/selarti-webhook.ts");
    const server = read("apps/api/src/server.ts");

    expect(route).not.toContain("decodeVerifiedWebhook");
    expect(route).not.toContain("headerRecord(request.headers)");
    expect(route).not.toContain("channelUserId");
    expect(route).not.toMatch(/userId:\s*event\./u);
    expect(server).not.toMatch(/fixture.*conversation.*(?:key|secret)/iu);
    expect(server).not.toContain("dispatch_v1");
    expect(server).not.toContain("cleanup_v1");
  });

  it("declares exact default-off runtime flags without embedding fixture secrets", () => {
    const env = read(".env.example");
    const config = read("packages/config/src/env.ts");

    expect(env).toContain("CLIENT_CONVERSATION_ENABLED=false");
    expect(env).toContain("CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED=false");
    expect(config).toContain(
      'CLIENT_CONVERSATION_ENABLED: z.enum(["true", "false"])',
    );
    expect(config).toMatch(
      /CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED:\s*z\s*\.enum\(\["true", "false"\]\)/u,
    );
    expect(config).not.toMatch(/CLIENT_CONVERSATION_(?:KEY|SECRET)/u);
  });
});
