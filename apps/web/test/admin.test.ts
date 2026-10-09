import { afterEach, describe, expect, it } from "vitest";
import { adminEnabled, newAdminToken, passwordMatches } from "../src/lib/admin";
import { rateLimited } from "../src/lib/http";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("admin password", () => {
  it("is disabled without a strong ADMIN_PASSWORD", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminEnabled()).toBe(false);
    expect(passwordMatches("")).toBe(false);
    process.env.ADMIN_PASSWORD = "short";
    expect(adminEnabled()).toBe(false);
  });
  it("accepts only the exact password", () => {
    process.env.ADMIN_PASSWORD = "correct-horse-battery";
    expect(passwordMatches("correct-horse-battery")).toBe(true);
    expect(passwordMatches("correct-horse-batter")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });
  it("issues expiring, signed tokens that change with the password", () => {
    process.env.ADMIN_PASSWORD = "correct-horse-battery";
    const a = newAdminToken();
    expect(a.value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(a.expires.getTime()).toBeGreaterThan(Date.now());
    process.env.ADMIN_PASSWORD = "another-long-password";
    const b = newAdminToken();
    expect(b.value.split(".")[1]).not.toBe(a.value.split(".")[1]);
  });
});

describe("login rate limit", () => {
  it("blocks after 5 attempts in the window", () => {
    const key = `admin-login:test-${Math.random()}`;
    const results = Array.from({ length: 6 }, () => rateLimited(key, 5, 60_000));
    expect(results).toEqual([false, false, false, false, false, true]);
  });
});
