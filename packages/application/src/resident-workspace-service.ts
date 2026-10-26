export type WorkspaceActivation =
  | { kind: "denied" }
  | {
      kind: "activated";
      applicationId: string;
      replay: boolean;
      access: "interview";
    };
/** Bot-independent admission. Caller supplies only the internal user identifier. */
export function createResidentWorkspaceService(deps: {
  enabled: boolean;
  repository: {
    activateResidentWorkspace(userId: string): Promise<WorkspaceActivation>;
  };
}) {
  return {
    async activateResidentWorkspace(
      userId: string,
    ): Promise<WorkspaceActivation> {
      if (
        !deps.enabled ||
        typeof userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          userId,
        )
      )
        return { kind: "denied" };
      // Repository errors intentionally propagate: proof/storage errors are never success.
      return deps.repository.activateResidentWorkspace(userId);
    },
  };
}
