export type ClientCommercialPolicy = "legacy_package_v1" | "free_client_v2";

export interface ClientCommercialPolicyPort {
  resolveOrAssign(input: {
    userId: string;
    allowV2Admission: boolean;
  }): Promise<ClientCommercialPolicy>;
}
