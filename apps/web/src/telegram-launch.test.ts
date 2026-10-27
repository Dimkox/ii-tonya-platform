import { expect, it } from "vitest";
import { readMiniAppLaunchData } from "./telegram-launch.js";
it("reads only one Telegram launch fragment without browser storage or SDK", () => {
  expect(
    readMiniAppLaunchData(
      "#tgWebAppData=user%3D%257B%2522id%2522%253A42%257D%26hash%3Dabc&tgWebAppVersion=8",
    ),
  ).toBe("user=%7B%22id%22%3A42%7D&hash=abc");
  expect(readMiniAppLaunchData("#tgWebAppData=one&tgWebAppData=two")).toBe("");
  expect(readMiniAppLaunchData("#tgWebAppData=" + "x".repeat(7000))).toBe("");
});
