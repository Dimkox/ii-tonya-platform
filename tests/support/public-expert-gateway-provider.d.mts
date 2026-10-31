export interface PublicExpertFuturePostgres {
  connectionString: string;
  offsetSeconds: number;
  imageId: string;
  advance(seconds: number): Promise<void>;
  stop(): Promise<void>;
}
export interface PublicExpertGatewayProvider {
  address: string;
  command(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
export function startPublicExpertFuturePostgres(): Promise<PublicExpertFuturePostgres>;
export function startPublicExpertGatewayProvider(
  connectionString: string,
  login: string,
  password: string,
  offsetSeconds: number,
): Promise<PublicExpertGatewayProvider>;
