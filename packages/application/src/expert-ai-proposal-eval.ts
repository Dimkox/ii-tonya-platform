import { validateExpertIntentProposal } from "./expert-prompt-context.js";

type Counts = Readonly<Record<string, number>>;
export interface ExpertProposalDistribution {
  readonly total: number;
  readonly accepted: Counts;
  readonly rejected: Counts;
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};
const ordered = (value: Record<string, number>): Counts =>
  Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );

export const evaluateExpertProposalDistribution = (
  proposals: readonly unknown[],
): ExpertProposalDistribution => {
  const accepted: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  for (const proposal of proposals) {
    const result = validateExpertIntentProposal(proposal);
    if (result.valid) increment(accepted, result.proposal.kind);
    else increment(rejected, result.reasonCode);
  }
  return {
    total: proposals.length,
    accepted: ordered(accepted),
    rejected: ordered(rejected),
  };
};

export const diffExpertProposalDistribution = (
  baseline: ExpertProposalDistribution,
  candidate: ExpertProposalDistribution,
): { readonly changed: boolean; readonly deltas: Counts } => {
  const deltas: Record<string, number> = {};
  for (const group of ["accepted", "rejected"] as const) {
    const keys = new Set([
      ...Object.keys(baseline[group]),
      ...Object.keys(candidate[group]),
    ]);
    for (const key of keys) {
      const delta = (candidate[group][key] ?? 0) - (baseline[group][key] ?? 0);
      if (delta !== 0) deltas[`${group}.${key}`] = delta;
    }
  }
  const totalDelta = candidate.total - baseline.total;
  if (totalDelta !== 0) deltas.total = totalDelta;
  return { changed: Object.keys(deltas).length > 0, deltas: ordered(deltas) };
};
