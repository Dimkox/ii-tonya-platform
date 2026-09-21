import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Пиннит ОТСУТСТВУЮЩУЮ модель источника для `qualifiedExpertCount` (замер 2026-09-21).
 *
 * DEC-FIN-012 говорит «считаются только qualified referral, уже принятые действующим движком
 * рефералки», но источника этого числа для CENTER/ORGANIZER в схеме нет:
 * `commercial_participants` = `id, user_id, participant_kind, onboarding_state, created_at`,
 * а `expert_referrals` связывает эксперта с экспертом (`inviter_expert_id`/`invitee_expert_id`)
 * и к партнёрскому участнику не привязан. Поэтому production-путь котировки передаёт литерал 0
 * (`partner-commerce-repository.ts:101`) и все shadow-котировки попадают в STANDARD.
 *
 * Тест обязан перевернуться: как только DEC-FIN-031 примет модель аффилиации и в схему добавят
 * связь, эти утверждения станут красными — вместе с ними обновляются `TASK-FIN-029`,
 * `DEC-FIN-031` и артефакты `fin-center-policy.md` / `fin-organizer-policy.md`.
 */
const participants = readFileSync(
  "packages/db/src/schema/partner-commerce.ts",
  "utf8",
);
const referrals = readFileSync(
  "packages/db/src/schema/expert-residency.ts",
  "utf8",
);
const quoteWriter = readFileSync(
  "packages/db/src/repositories/partner-commerce-repository.ts",
  "utf8",
);

describe("partner qualified-count source", () => {
  const participantsBlock =
    participants.slice(
      participants.indexOf("export const commercialParticipants"),
      participants.indexOf(
        "export const ",
        participants.indexOf("export const commercialParticipants") + 10,
      ),
    ) || "";

  it("has no expert-affiliation column on commercial_participants", () => {
    expect(participantsBlock.length).toBeGreaterThan(0);
    expect(participantsBlock).not.toMatch(/expert_id/);
    expect(participantsBlock).not.toMatch(/inviter/i);
    expect(participantsBlock).toMatch(
      /participantKind: text\("participant_kind"\)/,
    );
  });

  it("keeps expert_referrals expert-to-expert, not partner-to-expert", () => {
    const block = referrals.slice(
      referrals.indexOf("export const expertReferrals = pgTable("),
      referrals.indexOf("export const expertReferrals = pgTable(") + 2000,
    );
    expect(block).toMatch(/inviterExpertId/);
    expect(block).toMatch(/inviteeExpertId/);
    expect(block).not.toMatch(/participant_id/);
  });

  it("documents that the production quote path still passes a constant zero", () => {
    expect(quoteWriter).toMatch(/qualifiedExpertCount: 0/);
  });
});
