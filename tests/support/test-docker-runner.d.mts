export function getTestDockerRunner(): string | null;
export function getTestPostgresPorts(): Promise<{
  dockerArgs: string[];
  postgresArgs: string[];
  serverPort: number;
  clientPort(container: string): number;
}>;
export function startTestPsqlClient(directory: string): Promise<{
  psqlPath: string;
  stop(): void;
}>;
