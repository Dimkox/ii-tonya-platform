import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const probe = `
import sys
sys.path.insert(0, 'scripts')
from types import SimpleNamespace
from getzilla_ci_timeout import install_ci_test_timeout
seen=[]
def original(root, name, command, timeout=300, *, env=None):
    seen.append((name, command, timeout))
module=SimpleNamespace(_command_check=original)
install_ci_test_timeout(module)
module._command_check(None, 'pnpm-test', ['pnpm','run','test'], 900)
module._command_check(None, 'pnpm-lint', ['pnpm','run','lint'], 900)
module._command_check(None, 'pnpm-test', ['pnpm','run','other'], 900)
print(seen)
`;
describe("Getzilla hosted test timeout", () => {
  it("extends only the exact full-suite command once without changing other checks", () => {
    const result = execFileSync("python3", ["-c", probe], { encoding: "utf8" });
    expect(result).toContain("('pnpm-test', ['pnpm', 'run', 'test'], 3600)");
    expect(result).toContain("('pnpm-lint', ['pnpm', 'run', 'lint'], 900)");
    expect(result).toContain("('pnpm-test', ['pnpm', 'run', 'other'], 900)");
  });
});
