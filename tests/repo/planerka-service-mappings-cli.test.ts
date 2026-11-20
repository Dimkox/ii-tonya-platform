import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PlanerkaCandidateServiceRow } from "../../packages/db/src/repositories/planerka-service-mapping-admin.js";
import { runPlanerkaMappingsCli } from "../../scripts/planerka-service-mappings.js";

const SERVICE = "00000000-0000-4000-8000-000000000001";
const file = () => {
  const path = join(mkdtempSync(join(tmpdir(), "planerka-map-")), "m.json");
  writeFileSync(
    path,
    JSON.stringify({
      accountId: 7,
      mappings: [
        { expertServiceId: SERVICE, eventTypeId: 11, timeZone: "UTC" },
      ],
    }),
  );
  return path;
};
const fakeAdmin = () => ({
  listServices: vi.fn(
    async (): Promise<readonly PlanerkaCandidateServiceRow[]> => [],
  ),
  list: vi.fn(async () => []),
  plan: vi.fn(async () => [
    {
      expertServiceId: SERVICE,
      action: "insert" as const,
      durationMinutes: 60,
    },
  ]),
  apply: vi.fn(async () => [
    {
      expertServiceId: SERVICE,
      action: "insert" as const,
      durationMinutes: 60,
    },
  ]),
  setEnabled: vi.fn(async () => true),
  remove: vi.fn(async () => true),
});

describe("planerka-service-mappings CLI (SCRUM-519)", () => {
  it("services lists real UUIDs without changing them", async () => {
    const admin = fakeAdmin();
    admin.listServices.mockResolvedValue([
      {
        expertServiceId: SERVICE,
        expertId: "00000000-0000-4000-8000-000000000002",
        durationMinutes: 60,
        active: true,
      },
    ]);
    const lines: string[] = [];
    await expect(
      runPlanerkaMappingsCli(["services"], {}, (l) => lines.push(l), admin),
    ).resolves.toBe(0);
    expect(lines).toEqual([
      `${SERVICE} expert=00000000-0000-4000-8000-000000000002 duration=60 active=true`,
    ]);
    expect(admin.apply).not.toHaveBeenCalled();
  });

  it("plan is read-only", async () => {
    const admin = fakeAdmin();
    const lines: string[] = [];
    await expect(
      runPlanerkaMappingsCli(["plan", file()], {}, (l) => lines.push(l), admin),
    ).resolves.toBe(0);
    expect(admin.plan).toHaveBeenCalledTimes(1);
    expect(admin.apply).not.toHaveBeenCalled();
    expect(lines).toEqual([`plan insert ${SERVICE} duration=60`]);
  });

  it("apply requires --confirm", async () => {
    const admin = fakeAdmin();
    await expect(
      runPlanerkaMappingsCli(["apply", file()], {}, () => undefined, admin),
    ).resolves.toBe(2);
    expect(admin.apply).not.toHaveBeenCalled();
    await expect(
      runPlanerkaMappingsCli(
        ["apply", file(), "--confirm"],
        {},
        () => undefined,
        admin,
      ),
    ).resolves.toBe(0);
    expect(admin.apply).toHaveBeenCalledTimes(1);
  });

  it("checks the file account against PLANERKA_ACCOUNT_ID", async () => {
    await expect(
      runPlanerkaMappingsCli(
        ["plan", file()],
        { PLANERKA_ACCOUNT_ID: "8" },
        () => undefined,
        fakeAdmin(),
      ),
    ).rejects.toThrow("account_mismatch");
  });

  it("remove and purge-test-expert require --confirm", async () => {
    const admin = fakeAdmin();
    const purge = {
      purgeInactiveTestExpert: vi.fn(async () => ({
        operations: 1,
        reservations: 1,
        slots: 1,
        services: 1,
        expert: "removed" as const,
        user: "retained" as const,
      })),
    };
    const lines: string[] = [];
    await expect(
      runPlanerkaMappingsCli(["remove", SERVICE], {}, () => undefined, admin),
    ).resolves.toBe(2);
    expect(admin.remove).not.toHaveBeenCalled();
    await expect(
      runPlanerkaMappingsCli(
        ["remove", SERVICE, "--confirm"],
        {},
        (line) => lines.push(line),
        admin,
      ),
    ).resolves.toBe(0);
    expect(admin.remove).toHaveBeenCalledWith(SERVICE);
    expect(lines).toEqual([`remove ${SERVICE} removed`]);
    await expect(
      runPlanerkaMappingsCli(
        ["purge-test-expert", SERVICE],
        {},
        () => undefined,
        admin,
        purge,
      ),
    ).resolves.toBe(2);
    expect(purge.purgeInactiveTestExpert).not.toHaveBeenCalled();
    await expect(
      runPlanerkaMappingsCli(
        ["purge-test-expert", SERVICE, "--confirm"],
        {},
        (line) => lines.push(line),
        admin,
        purge,
      ),
    ).resolves.toBe(0);
    expect(purge.purgeInactiveTestExpert).toHaveBeenCalledWith(SERVICE);
  });

  it("ships a javascript release entry that does not need tsx", () => {
    const entry = readFileSync("scripts/planerka-service-mappings.mjs", "utf8");
    expect(entry).not.toMatch(/\btsx\b/);
    expect(entry).toContain('from "../packages/db/dist/index.js"');
    expect(readFileSync("scripts/build-native-release.sh", "utf8")).toContain(
      'cp scripts/planerka-service-mappings.mjs "$work_dir/release/scripts/planerka-service-mappings.mjs"',
    );
  });

  it("disable/enable toggle a mapping; unknown command prints usage", async () => {
    const admin = fakeAdmin();
    await runPlanerkaMappingsCli(
      ["disable", SERVICE],
      {},
      () => undefined,
      admin,
    );
    expect(admin.setEnabled).toHaveBeenCalledWith(SERVICE, false);
    await expect(
      runPlanerkaMappingsCli(["oops"], {}, () => undefined, admin),
    ).resolves.toBe(2);
  });

  it("needs DATABASE_URL without an injected admin", async () => {
    await expect(
      runPlanerkaMappingsCli(["list"], {}, () => undefined),
    ).rejects.toThrow("database_url_required");
  });
});
