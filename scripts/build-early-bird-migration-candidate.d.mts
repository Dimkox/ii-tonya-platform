export interface EarlyBirdCandidateObservation {
  status: "temporary_candidate_not_release_approval";
  observeCurrentSources: boolean;
  tag: string;
  candidateSha256: string;
  sources: {
    source: string;
    sourceSha256: string;
    selectedSha256: string;
    bytes: number;
  }[];
}
export function buildEarlyBirdMigrationCandidate(options: {
  root: string;
  output: string;
  observeCurrentSources?: boolean;
}): Promise<EarlyBirdCandidateObservation>;
export function assertCandidateSourcesUnchanged(
  root: string,
  observation: EarlyBirdCandidateObservation,
): Promise<void>;
