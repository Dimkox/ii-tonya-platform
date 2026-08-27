import { globSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { describe, expect, it } from "vitest";
import { preProcessFile } from "typescript";
import { parse } from "yaml";

const required = {
  ".": {
    dependencies: [],
    devDependencies: [
      "@eslint/js",
      "@types/node",
      "@vitest/coverage-v8",
      "eslint",
      "globals",
      "prettier",
      "tsup",
      "tsx",
      "typescript",
      "typescript-eslint",
      "vitest",
      "yaml",
    ],
  },
  "apps/api": {
    dependencies: [
      "@fastify/rate-limit",
      "@ii-tonya/application",
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "fastify",
    ],
    devDependencies: [],
  },
  "apps/worker": {
    dependencies: [
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "@ii-tonya/worker",
    ],
    devDependencies: [],
  },
  "packages/application": {
    dependencies: ["@ii-tonya/contracts", "@ii-tonya/domain"],
    devDependencies: [],
  },
  "packages/config": { dependencies: ["zod"], devDependencies: [] },
  "packages/contracts": { dependencies: ["zod"], devDependencies: [] },
  "packages/db": {
    dependencies: [
      "@ii-tonya/contracts",
      "@ii-tonya/domain",
      "drizzle-orm",
      "pg",
    ],
    devDependencies: ["@testcontainers/postgresql", "@types/pg", "drizzle-kit"],
  },
  "packages/domain": { dependencies: [], devDependencies: ["fast-check"] },
  "packages/integrations": {
    dependencies: ["@ii-tonya/contracts", "zod"],
    devDependencies: [],
  },
  "packages/observability": {
    dependencies: ["@opentelemetry/api", "@opentelemetry/sdk-node", "pino"],
    devDependencies: [],
  },
  "packages/worker": {
    dependencies: [
      "@ii-tonya/application",
      "@ii-tonya/contracts",
      "@ii-tonya/db",
      "@ii-tonya/domain",
      "@ii-tonya/integrations",
    ],
    devDependencies: [],
  },
} as const;

const manifestAt = (root: string) =>
  JSON.parse(
    readFileSync(
      root === "." ? "package.json" : `${root}/package.json`,
      "utf8",
    ),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    exports?: { "."?: { import?: string; types?: string } };
    files?: string[];
    main?: string;
    types?: string;
    packageManager?: string;
  };

const runtimePackageRoots = [
  "packages/application",
  "packages/config",
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/integrations",
  "packages/observability",
  "packages/worker",
] as const;

const importOwner = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0]!;
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

describe("workspace dependency ownership remediation", () => {
  it.each(Object.entries(required))(
    "%s owns every current and planned import",
    (root, expected) => {
      const manifest = manifestAt(root);
      for (const name of expected.dependencies) {
        expect(
          manifest.dependencies?.[name],
          `${root} runtime ${name}`,
        ).toBeDefined();
        if (name.startsWith("@ii-tonya/"))
          expect(manifest.dependencies?.[name]).toBe("workspace:*");
      }
      for (const name of expected.devDependencies) {
        expect(
          manifest.devDependencies?.[name],
          `${root} development ${name}`,
        ).toBeDefined();
      }
    },
  );

  it("does not hide package runtime imports in root development dependencies", () => {
    const root = manifestAt(".");
    expect(root.dependencies ?? {}).toEqual({});
    expect(root.devDependencies).not.toHaveProperty("zod");
    expect(root.packageManager).toBe("pnpm@11.9.0");
    expect(root.scripts?.build).toBe(
      "pnpm --workspace-concurrency=1 -r --sort run build",
    );
    expect(root.scripts?.typecheck).toBe(
      "pnpm --workspace-concurrency=1 -r --sort run typecheck && tsc --noEmit -p tsconfig.tests.json",
    );
    expect(root.scripts?.["test:repeat"]).toBe(
      "node scripts/repeat-vitest.mjs",
    );
    expect(root.scripts?.["verify:clean-workspace"]).toBe(
      "node scripts/verify-clean-workspace.mjs",
    );
    expect(root.scripts?.["test:pnpm-launcher"]).toBe(
      "node scripts/pnpm-launcher-self-test.mjs",
    );
  });

  it("serializes the topological root build to avoid concurrent DTS cleans", () => {
    expect(manifestAt(".").scripts?.build).toBe(
      "pnpm --workspace-concurrency=1 -r --sort run build",
    );
  });

  it("semantically typechecks tests and testkits in addition to runtime sources", () => {
    const config = JSON.parse(readFileSync("tsconfig.tests.json", "utf8")) as {
      extends?: string;
      compilerOptions?: {
        noEmit?: boolean;
        paths?: Record<string, string[]>;
      };
      include?: string[];
    };

    expect(config.extends).toBe("./tsconfig.base.json");
    expect(config.compilerOptions?.noEmit).toBe(true);
    expect(config.compilerOptions?.paths?.["@ii-tonya/*"]).toEqual([
      "packages/*/src/index.ts",
    ]);
    expect(config.include).toEqual(
      expect.arrayContaining([
        "apps/**/*.test.ts",
        "apps/**/*.testkit.ts",
        "apps/**/src/testkit/**/*.ts",
        "packages/**/*.test.ts",
        "packages/**/*.testkit.ts",
        "packages/**/src/testkit/**/*.ts",
        "tests/**/*.ts",
      ]),
    );
  });

  it("derives manifest ownership from every non-test runtime source import", () => {
    const missing: string[] = [];
    const files = [
      ...globSync("apps/*/src/**/*.ts"),
      ...globSync("packages/*/src/**/*.ts"),
    ]
      .filter((file) => !/(\.test|\.testkit)\.ts$/.test(file))
      .filter((file) => !file.replaceAll("\\", "/").includes("/src/testkit/"));
    for (const file of files) {
      const [top, workspace] = file.replaceAll("\\", "/").split("/");
      const root = `${top}/${workspace}`;
      const dependencies = manifestAt(root).dependencies ?? {};
      const imported = preProcessFile(
        readFileSync(file, "utf8"),
        true,
        true,
      ).importedFiles;
      for (const { fileName } of imported) {
        if (fileName.startsWith(".") || nodeBuiltins.has(fileName)) continue;
        const owner = importOwner(fileName);
        if (dependencies[owner] === undefined)
          missing.push(`${file} -> ${owner}`);
        if (
          owner.startsWith("@ii-tonya/") &&
          dependencies[owner] !== "workspace:*"
        ) {
          missing.push(`${file} -> ${owner} must use workspace:*`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("owns database testkit dependencies only as development dependencies", () => {
    const manifest = manifestAt("packages/db");
    expect(manifest.dependencies).not.toHaveProperty(
      "@testcontainers/postgresql",
    );
    expect(manifest.devDependencies).toHaveProperty(
      "@testcontainers/postgresql",
    );
  });

  it("emits JavaScript and declarations for every runtime library", () => {
    for (const root of runtimePackageRoots) {
      const manifest = manifestAt(root);
      expect(manifest.scripts?.build).toBe(
        "tsup src/index.ts --format esm --dts --clean --tsconfig ../../tsconfig.base.json",
      );
      expect(manifest.scripts?.typecheck).toBe("tsc --noEmit");
      expect(manifest.exports?.["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      });
      expect(manifest.main).toBe("./dist/index.js");
      expect(manifest.types).toBe("./dist/index.d.ts");
      expect(manifest.files).toContain("dist");
    }
    expect(manifestAt("apps/api").dependencies?.["@ii-tonya/db"]).toBe(
      "workspace:*",
    );
    const workspace = parse(readFileSync("pnpm-workspace.yaml", "utf8")) as {
      injectWorkspacePackages?: boolean;
      syncInjectedDepsAfterScripts?: string[];
    };
    expect(workspace.injectWorkspacePackages).toBe(true);
    expect(workspace.syncInjectedDepsAfterScripts).toContain("build");
  });
});
