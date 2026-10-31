export interface EarlyBirdRoleCapability {
  role: string;
  migration: number;
  runtimeKeys: string[];
  functions: string[];
}
export function loadEarlyBirdRoleCapabilities(
  throughMigration?: number,
): Promise<EarlyBirdRoleCapability[]>;
export function buildEarlyBirdRoleProvisioningSql(
  mapping: Record<string, string>,
  options?: { financialLogin?: string; throughMigration?: number },
): Promise<string>;
