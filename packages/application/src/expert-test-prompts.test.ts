import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERT_TEST_SOURCE_PATH,
  EXPERT_TEST_STAGE_SOURCES,
} from "./expert-test-prompt-sources.js";
import {
  EXPERT_INTAKE_QUESTIONS,
  EXPERT_TEST_PROMPTS,
  expertTestSystemPrompt,
  nextExpertIntakeQuestion,
  recordExpertIntakeAnswer,
  routeExpertTestEntry,
} from "./expert-test-prompts.js";

const src = readFileSync(
  new URL(`../../../${EXPERT_TEST_SOURCE_PATH}`, import.meta.url),
  "utf8",
).split("\n");
const squash = (t: string) =>
  t
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/ ?-{3}$/u, "")
    .trim();

describe("expert_test prompts v1 (SCRUM-501 slice 3)", () => {
  it.each(EXPERT_TEST_STAGE_SOURCES.map((s) => [s.stage, s] as const))(
    "%s is verbatim from the owner source lines",
    (_stage, s) => {
      expect(squash(s.text)).toBe(
        squash(src.slice(s.lines[0] - 1, s.lines[1]).join("\n")),
      );
    },
  );

  it("covers source 2672-3047 contiguously and A062-A069", () => {
    const req = new Set(
      EXPERT_TEST_STAGE_SOURCES.flatMap((s) => s.requirements),
    );
    expect([...req].sort()).toEqual([
      "A062",
      "A063",
      "A064",
      "A065",
      "A066",
      "A067",
      "A068",
      "A069",
    ]);
    for (const p of EXPERT_TEST_PROMPTS.values()) {
      expect(p).toMatchObject({ version: 1, status: "active" });
      expect(p.promptId).toMatch(/^expert_test\.[a-z_]+$/u);
    }
  });

  it("system prompt carries version, role and server-authority guard", () => {
    const p = expertTestSystemPrompt("expert_intake");
    expect(p.startsWith("Версия expert_test.expert_intake@1.")).toBe(true);
    expect(p).toContain("1. РОЛЬ И ЗАДАЧА");
    expect(p).toContain("определяет только сервер");
    expect(p).toContain("ЭТАП 3: ЗНАКОМСТВО С ЭКСПЕРТОМ");
  });
});

describe("routeExpertTestEntry (A063)", () => {
  it.each([
    ["тест эксперт", "test_code"],
    ["  Тест Эксперт! ", "test_code"],
    ["«тест эксперт»", "test_code"],
    ["promo_abcdEFGH1234", "referral_code"],
    ["Я уже всё знаю, хочу купить участие!", "wants_to_buy"],
    ["хочу попробовать", "wants_to_try"],
    ["привет", "unclear"],
  ])("%s -> %s", (msg, kind) => {
    expect(routeExpertTestEntry(msg).kind).toBe(kind);
  });
  it("buying routes to server pricing, never to historical prices", () => {
    expect(routeExpertTestEntry("хочу купить").next).toBe("server_pricing");
  });
});

describe("expert intake (A065)", () => {
  it("asks one question at a time and resumes after restart", () => {
    let a = {};
    const asked: string[] = [];
    for (;;) {
      const q = nextExpertIntakeQuestion(a);
      if (!q) break;
      asked.push(q.key);
      a = recordExpertIntakeAnswer(a, q.key, `ответ ${q.key}`);
    }
    expect(asked).toEqual(EXPERT_INTAKE_QUESTIONS.map((q) => q.key));
    expect(nextExpertIntakeQuestion({ name: "Анна", services: " " })?.key).toBe(
      "services",
    );
  });
  it("keeps raw answers and allows correction of one key", () => {
    const a = recordExpertIntakeAnswer({ name: "Аня" }, "services", "  КПТ ");
    expect(recordExpertIntakeAnswer(a, "name", "Анна")).toEqual({
      name: "Анна",
      services: "  КПТ ",
    });
    expect(() =>
      recordExpertIntakeAnswer(a, "name", "x".repeat(4001)),
    ).toThrow();
  });
});
