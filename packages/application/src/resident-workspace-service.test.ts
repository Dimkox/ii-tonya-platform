import { expect, it, vi } from "vitest";
import { createResidentWorkspaceService } from "./resident-workspace-service.js";
it("uses internal IDs and stored authority, disabled and malformed requests deny", async () => {
  const repository = {
    activateResidentWorkspace: vi.fn(async () => ({ kind: "denied" as const })),
  };
  const service = createResidentWorkspaceService({ enabled: true, repository });
  expect(await service.activateResidentWorkspace("telegram:123")).toEqual({
    kind: "denied",
  });
  expect(repository.activateResidentWorkspace).not.toHaveBeenCalled();
  const id = "11111111-1111-4111-8111-111111111111";
  expect(await service.activateResidentWorkspace(id)).toEqual({
    kind: "denied",
  });
  expect(repository.activateResidentWorkspace).toHaveBeenCalledWith(id);
  expect(
    await createResidentWorkspaceService({
      enabled: false,
      repository,
    }).activateResidentWorkspace(id),
  ).toEqual({ kind: "denied" });
});
