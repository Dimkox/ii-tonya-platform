import { expect, it } from "vitest";
import {
  gatewayContactToken,
  gatewayUserToken,
} from "./experimental-gateway-ipc.js";
it("uses a separate domain per contact, keeping new contacts independent", () => {
  const key = Buffer.alloc(32, 1),
    first = "2526c71d-803f-4c3d-9b57-74e902170001",
    second = "2526c71d-803f-4c3d-9b57-74e902170002";
  expect(gatewayContactToken(key, first)).not.toBe(
    gatewayUserToken(key, first),
  );
  expect(gatewayContactToken(key, first)).not.toBe(
    gatewayContactToken(key, second),
  );
  expect(gatewayContactToken(key, first.toUpperCase())).toBe(
    gatewayContactToken(key, first),
  );
});
