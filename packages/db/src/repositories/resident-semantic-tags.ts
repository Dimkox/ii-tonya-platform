import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  exactTagCandidates,
  type SemanticCatalogueTag,
  type SemanticHelper,
  type TagCandidate,
} from "@ii-tonya/contracts";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
export async function tagCatalogue(
  tx: ExpertCardTransaction,
): Promise<SemanticCatalogueTag[]> {
  await tx.execute(sql`lock table hashtags_db in share mode`);
  return (
    await tx.execute<SemanticCatalogueTag & Record<string, unknown>>(
      sql`select id,tag_value as "tagValue",display_label as "displayLabel",synonyms_json as synonyms,weight_score as "weightScore",is_active as "isActive",jsonb_build_object('seed',source_sha256,'extensions',synonym_provenance) as provenance from hashtags_db order by id limit 513`,
    )
  ).rows;
}
export const catalogueDigest = (catalogue: SemanticCatalogueTag[]) =>
  createHash("sha256").update(JSON.stringify(catalogue)).digest("hex");
export async function recommendTags(
  tx: ExpertCardTransaction,
  catalogue: SemanticCatalogueTag[],
  text: string,
  helper?: SemanticHelper,
): Promise<{
  candidates: TagCandidate[];
  mode: "semantic" | "exact-only";
  generation: string;
}> {
  const fallback = {
    candidates: exactTagCandidates(text, catalogue),
    mode: "exact-only" as const,
    generation: "exact-only-v1",
  };
  if (!helper || catalogue.length > 512) return fallback;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('resident_public_semantic_cache',0))`,
  );
  const state = await helper.call("state");
  if (
    !state ||
    typeof state.model !== "string" ||
    !/^[a-f0-9]{64}$/u.test(state.model)
  )
    return fallback;
  const registry = catalogueDigest(catalogue);
  const current = (
    await tx.execute<{ generation: string; model: string; taxonomy: string }>(
      sql`select generation,model_digest as model,taxonomy_digest as taxonomy from tag_embeddings_cache where singleton`,
    )
  ).rows[0];
  let generation: string;
  if (
    !current ||
    current.model !== state.model ||
    current.taxonomy !== registry
  ) {
    const cache = await helper.call("prepare", { catalogue });
    if (
      !cache ||
      cache.model !== state.model ||
      typeof cache.generation !== "string" ||
      !/^[a-f0-9]{64}$/u.test(cache.generation)
    )
      return fallback;
    generation = cache.generation;
    await tx.execute(
      sql`insert into tag_embeddings_cache(singleton,generation,model_digest,taxonomy_digest,cache) values(true,${generation},${state.model},${registry},${JSON.stringify(cache)}::jsonb) on conflict(singleton) do update set generation=excluded.generation,model_digest=excluded.model_digest,taxonomy_digest=excluded.taxonomy_digest,cache=excluded.cache`,
    );
  } else {
    generation = current.generation;
    if (state.generation !== generation) {
      const row = (
        await tx.execute<{ cache: Record<string, unknown> }>(
          sql`select cache from tag_embeddings_cache where singleton`,
        )
      ).rows[0];
      const restored = await helper.call("restore", { cache: row?.cache });
      if (restored?.generation !== generation) return fallback;
    }
  }
  const result = await helper.call("recommend", { generation, text });
  if (
    result?.generation !== generation ||
    !Array.isArray(result.candidates) ||
    result.candidates.length > 15
  )
    return fallback;
  const candidates: TagCandidate[] = [];
  for (const raw of result.candidates) {
    const r = raw as TagCandidate,
      tag = catalogue.find((t) => t.id === r.id && t.isActive);
    if (
      !tag ||
      tag.displayLabel !== r.label ||
      ![100, 50].includes(r.score) ||
      typeof r.evidence !== "string" ||
      r.evidence.length > 160 ||
      (r.score === 50 &&
        (!Number.isFinite(r.cosine) || r.cosine! <= 0.85 || r.cosine! > 1))
    )
      return fallback;
    candidates.push({ ...r, weight: tag.weightScore });
  }
  return { candidates, mode: "semantic", generation };
}
