import { describe, expect, it } from "vitest";
import { createSafeDocumentParser } from "./safe-document-parser.js";
describe("bounded local document parsing", () => {
  it("fails closed when disabled, unavailable, aborted or oversized", async () => {
    const parser = createSafeDocumentParser({ enabled: false });
    expect(
      await parser.parse({
        bytes: Buffer.from("private"),
        type: "pdf",
        signal: new AbortController().signal,
      }),
    ).toBeNull();
    const enabled = createSafeDocumentParser({
      enabled: true,
      pythonExecutable: "/missing/parser-python",
    });
    expect(
      await enabled.parse({
        bytes: Buffer.from("%PDF-broken"),
        type: "pdf",
        signal: new AbortController().signal,
      }),
    ).toBeNull();
    const abort = new AbortController();
    abort.abort();
    expect(
      await enabled.parse({
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
        type: "pdf",
        signal: abort.signal,
      }),
    ).toBeNull();
  });
});

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { vi } from "vitest";
it("kills timeout and abort children, rejects crash, flood and raw error output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "private-parser-"));
  const python = process.env.II_TONYA_PARSER_PYTHON ?? "/usr/bin/python3";
  const warning = vi.fn();
  try {
    for (const source of [
      "import time; time.sleep(20)",
      "raise RuntimeError('PRIVATE_TOKEN_PATH_SENTINEL')",
      "import sys; sys.stdout.write('x'*500000)",
      "import sys; sys.stderr.write('PRIVATE_TOKEN_PATH_SENTINEL')",
      `import json; print(json.dumps({"source":"pdf","content":chr(34)*50000}))`,
    ]) {
      const helper = join(dir, "helper.py");
      writeFileSync(helper, source);
      const parser = createSafeDocumentParser({
        enabled: true,
        pythonExecutable: python,
        helperPath: helper,
        timeoutMs: 100,
        warning,
      });
      const before = Date.now();
      expect(
        await parser.parse({
          bytes: Buffer.from("private document"),
          type: "pdf",
          signal: new AbortController().signal,
        }),
      ).toBeNull();
      expect(Date.now() - before).toBeLessThan(2000);
    }
    writeFileSync(join(dir, "helper.py"), "import time; time.sleep(20)");
    const parser = createSafeDocumentParser({
      enabled: true,
      pythonExecutable: python,
      helperPath: join(dir, "helper.py"),
      warning,
    });
    const controller = new AbortController();
    const promise = parser.parse({
      bytes: Buffer.from("private"),
      type: "pdf",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    expect(await promise).toBeNull();
    expect(
      warning.mock.calls.every(
        (call) => call.length === 1 && call[0] === "document_parse_unavailable",
      ),
    ).toBe(true);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      "PRIVATE_TOKEN_PATH_SENTINEL",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it.runIf(!!process.env.II_TONYA_PARSER_PYTHON)(
  "extracts real synthetic PDF and DOCX through the locked helper",
  async () => {
    const python = process.env.II_TONYA_PARSER_PYTHON!;
    const data = JSON.parse(
      execFileSync(
        python,
        [
          "-I",
          "-c",
          `import io,json,base64,pymupdf;from docx import Document
text='A private synthetic professional biography for local document extraction acceptance. '*3
pdf=pymupdf.open();page=pdf.new_page();page.insert_text((50,50),text)
doc=Document();doc.add_paragraph(text);out=io.BytesIO();doc.save(out)
print(json.dumps({'pdf':base64.b64encode(pdf.tobytes()).decode(),'docx':base64.b64encode(out.getvalue()).decode()}))`,
        ],
        { maxBuffer: 1024 * 1024 },
      ).toString(),
    );
    const parser = createSafeDocumentParser({
      enabled: true,
      pythonExecutable: python,
      helperPath: resolve("packages/integrations/parser/helper.py"),
    });
    for (const type of ["pdf", "docx"] as const) {
      const result = await parser.parse({
        bytes: Buffer.from(data[type], "base64"),
        type,
        signal: new AbortController().signal,
      });
      expect(result?.source).toBe(type);
      expect(result!.content.length).toBeGreaterThanOrEqual(50);
    }
    expect(
      readFileSync(resolve("packages/integrations/parser/uv.lock"), "utf8"),
    ).toContain('name = "pymupdf"');
  },
);
