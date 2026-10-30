import type { DrizzleDb } from "../client.js";
import { requireWorkerPrincipal } from "./early-bird-worker-principal.js";
type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
export async function requireWorkerReviewPrincipal(
  tx: Transaction,
  login: string,
): Promise<void> {
  return requireWorkerPrincipal(
    tx,
    login,
    "ii_tonya_worker_review_source",
    "public.early_bird_worker_review_list(uuid,integer)",
    "public.early_bird_worker_review_resolve(uuid,uuid)",
  );
}
