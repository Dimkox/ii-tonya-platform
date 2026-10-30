import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Python CI discovery", () => {
  it("configures the actual pytest runner with the unchanged coverage policy", () => {
    const config = readFileSync("pyproject.toml", "utf8");
    expect(config).toContain("[tool.pytest.ini_options]");
    for (const path of [
      "scripts/experimental/yookassa_gateway",
      "scripts/test_getzilla_reviewed_opengrep.py",
      "tests/runtime",
      "deploy/gateway-provision",
    ])
      expect(config).toContain(`"${path}"`);
    expect(config).toContain("--cov-config=.coveragerc");
    expect(config).toContain("--cov-fail-under=74");
    expect(config).toContain("--cov-branch");
  });
  for (const path of [
    ".github/workflows/getzilla-verify.yml",
    ".getzilla/templates/ci/github-actions-verify.yml",
  ]) {
    it(`runs the Getzilla pytest gate once and separately tests Node tools in ${path}`, () => {
      const workflow = readFileSync(path, "utf8");
      expect(workflow).toContain("python scripts/getzilla_verify_ci.py");
      expect(workflow).toContain(
        "node --test scripts/early-bird-bridge/*.test.mjs deploy/gateway-provision/*.test.mjs",
      );
      expect(workflow).toContain(
        "sudo -n bash deploy/gateway-provision/test_prepare_systemd_sandbox.sh",
      );
      expect(workflow).not.toContain("python -m unittest discover");
    });
  }
});
