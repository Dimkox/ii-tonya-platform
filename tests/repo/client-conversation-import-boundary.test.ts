import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("client conversation authority boundaries", () => {
  it("keeps claim implementation private and database facts authority-free", () => {
    const authority = readFileSync(
      resolve(
        root,
        "packages/application/src/client-conversation-authority.ts",
      ),
      "utf8",
    );
    const applicationIndex = readFileSync(
      resolve(root, "packages/application/src/index.ts"),
      "utf8",
    );
    const repository = readFileSync(
      resolve(
        root,
        "packages/db/src/repositories/client-conversation-principal-repository.ts",
      ),
      "utf8",
    );

    expect(authority).not.toMatch(
      /export\s+class\s+RuntimeConversationOperationClaim/u,
    );
    expect(authority).not.toMatch(
      /export\s+(?:const|function)\s+(?:read|mint)Claim/u,
    );
    expect(applicationIndex).not.toContain("RuntimeConversationOperationClaim");
    expect(repository).not.toContain("channel_identities");
    expect(repository).not.toMatch(/\b(?:insert|update|delete|upsert)\b/iu);
    expect(repository).toContain("from provider_subject_mappings m");
    expect(repository).toContain(
      "join users u on u.id=m.user_id and u.active=true",
    );
    expect(repository).toContain("m.provider='selarti.client-thread.v1'");
    expect(repository).toContain("m.tenant_token=${input.tenantToken}");
    expect(repository).toContain("m.subject_token=${input.subjectToken}");
    expect(repository).toContain("m.token_version=1");
    expect(repository).not.toContain("@ii-tonya/application");
    expect(authority).not.toContain("@ii-tonya/db");
  });
});
