export declare const FULL_SHA: RegExp;
export declare function releaseTag(sha: string): string;
export declare function parseArgs(argv: string[]): {
  sha: string;
  date: string;
  host: string;
  evidence?: string;
  liveCheck: boolean;
  dryRun: boolean;
};
export declare function releaseNotes(input: {
  sha: string;
  date: string;
  host: string;
  evidence?: string;
  liveSha?: string;
}): string;
