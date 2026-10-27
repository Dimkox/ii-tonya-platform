import { z } from "zod";
export const tagLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => /^[\p{L}\p{N}#_ +./()-]+$/u.test(v));
export const tagSelectionSchema = z.array(tagLabelSchema).max(20);
export function normalizeTag(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[#_]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
export interface SemanticCatalogueTag {
  id: string;
  tagValue: string;
  displayLabel: string;
  synonyms: { term: string }[];
  weightScore: number;
  isActive: boolean;
  provenance?: unknown;
}
export interface TagCandidate {
  id: string;
  label: string;
  score: 100 | 50 | 0;
  weight: number;
  evidence: string;
  cosine: number | null;
  kind?: "catalogue" | "format" | "related";
}
export interface TagPreview {
  token: string;
  revision: number;
  scope: string;
  scopeLabel: string;
  selected: string[];
  choices: string[];
  candidates: TagCandidate[];
  mode: "semantic" | "exact-only";
  generation: string;
  registry: string;
  safety: string;
  customInput?: { requestKey: string; messageId?: string };
}
export function canonicalTag(
  value: string,
  catalogue: readonly SemanticCatalogueTag[],
): string {
  const n = normalizeTag(value);
  const row = [...catalogue]
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((r) =>
      [r.tagValue, r.displayLabel, ...r.synonyms.map((s) => s.term)].some(
        (s) => normalizeTag(s) === n,
      ),
    );
  return row ? `catalogue:${row.id}` : `custom:${n}`;
}
/** Honest local fallback uses complete Unicode words/phrases, never a semantic score. */
export function exactTagCandidates(
  text: string,
  catalogue: readonly SemanticCatalogueTag[],
): TagCandidate[] {
  if (text.length > 16000) throw Error("card_invalid_tags");
  const segments = text
    .split(/[;\n.!?]+/u)
    .map(normalizeTag)
    .filter(
      (s) =>
        !/(?:^|\s)(?:не|нет|без|никогда|ни|кроме|исключая)(?:\s|$)/u.test(s),
    );
  return catalogue
    .filter((r) => r.isActive)
    .flatMap((r) => {
      const term = [r.tagValue, ...r.synonyms.map((s) => s.term)].find((t) => {
        const words = normalizeTag(t).match(/[\p{L}\p{N}]+/gu) ?? [];
        return (
          words.length > 0 &&
          segments.some((s) =>
            ` ${(s.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")} `.includes(
              ` ${words.join(" ")} `,
            ),
          )
        );
      });
      return term
        ? [
            {
              id: r.id,
              label: r.displayLabel,
              score: 100 as const,
              weight: r.weightScore,
              evidence: term,
              cosine: null,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score || b.weight - a.weight || a.id.localeCompare(b.id),
    )
    .slice(0, 15);
}
export interface SemanticHelper {
  call(
    operation: "state" | "prepare" | "restore" | "recommend",
    payload?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}
