export interface EarlyBirdRoleCapability {
  role: string;
  migration: number;
  runtimeKeys: string[];
  functions: string[];
}
export function loadEarlyBirdRoleCapabilities(): Promise<
  EarlyBirdRoleCapability[]
>;
export function buildEarlyBirdRoleProvisioningSql(
  mapping: Record<string, string>,
): Promise<string>;
