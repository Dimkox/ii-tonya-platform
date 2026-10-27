import { expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://user:password@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  CLIENT_SESSION_ENABLED: "true",
  CLIENT_PRIVACY_ENABLED: "true",
};
it("keeps erasure creation closed by default without disabling privacy rights", () => {
  expect(loadEnv(base).features).toMatchObject({
    clientPrivacy: true,
    clientErasureRequests: false,
  });
  expect(
    loadEnv({ ...base, CLIENT_ERASURE_REQUESTS_ENABLED: "true" }).features,
  ).toMatchObject({ clientPrivacy: true, clientErasureRequests: true });
  expect(
    loadEnv({ ...base, CLIENT_ERASURE_REQUESTS_ENABLED: "false" }).features,
  ).toMatchObject({ clientPrivacy: true, clientErasureRequests: false });
});
