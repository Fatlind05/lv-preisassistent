import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessCode, verifyAccessToken } from "../app/lib/access-token";

const originalCode = process.env.APP_ACCESS_CODE;
const originalSecret = process.env.ACCESS_SESSION_SECRET;

describe("code access", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "2005";
    process.env.ACCESS_SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    if (originalCode === undefined) delete process.env.APP_ACCESS_CODE;
    else process.env.APP_ACCESS_CODE = originalCode;
    if (originalSecret === undefined) delete process.env.ACCESS_SESSION_SECRET;
    else process.env.ACCESS_SESSION_SECRET = originalSecret;
  });

  it("accepts the configured code and rejects a wrong code", async () => {
    await expect(verifyAccessCode("2005")).resolves.toBe(true);
    await expect(verifyAccessCode("2004")).resolves.toBe(false);
  });

  it("accepts only a valid signed session token", async () => {
    const token = await createAccessToken();
    const replacement = token.endsWith("0") ? "1" : "0";
    await expect(verifyAccessToken(token)).resolves.toBe(true);
    await expect(verifyAccessToken(`${token.slice(0, -1)}${replacement}`)).resolves.toBe(false);
    await expect(verifyAccessToken(undefined)).resolves.toBe(false);
  });
});
