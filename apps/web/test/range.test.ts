import { describe, expect, it } from "vitest";
import { cycleStart, resolveRange } from "../src/lib/range";
import { validateTarget } from "../src/lib/alerts";

describe("ranges", () => {
  it("computes the billing cycle start", () => {
    expect(cycleStart(new Date("2026-10-08T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(cycleStart(new Date("2026-10-08T00:00:00Z"), 15).toISOString().slice(0, 10)).toBe("2026-09-15");
  });
  it("defaults to 30 days and builds an equal previous period", () => {
    const r = resolveRange("bogus", 1, new Date("2026-10-08T00:00:00Z"));
    expect(r.key).toBe("30d");
    expect(r.to.getTime() - r.from.getTime()).toBe(r.prevTo.getTime() - r.prevFrom.getTime());
  });
});

describe("alert targets", () => {
  it("rejects private or non-https webhooks", () => {
    expect(validateTarget("webhook", "http://example.com/x")).toMatch(/https/);
    expect(validateTarget("webhook", "https://127.0.0.1/x")).toMatch(/public/);
    expect(validateTarget("webhook", "https://192.168.1.4/x")).toMatch(/public/);
    expect(validateTarget("slack", "https://evil.com/hook")).toMatch(/slack/);
    expect(validateTarget("slack", "https://hooks.slack.com/services/T/B/x")).toBeNull();
    expect(validateTarget("email", "a@b.co")).toBeNull();
  });
});
