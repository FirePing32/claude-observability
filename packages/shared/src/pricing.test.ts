import { describe, expect, it } from "vitest";
import { computeValueUsd, detectPlan, findPrice } from "./pricing";

describe("findPrice", () => {
  it("prefers the longest matching model id", () => {
    expect(findPrice("claude-opus-5-5")?.label).toBe("Opus 5.5");
    expect(findPrice("claude-opus-5")?.label).toBe("Opus 5");
    expect(findPrice("claude-sonnet-5")?.label).toBe("Sonnet 5");
    expect(findPrice("claude-sonnet-5-5")?.label).toBe("Sonnet 5.5");
  });
  it("normalizes dated, provider-prefixed and context-suffixed ids", () => {
    expect(findPrice("claude-sonnet-4-5-20250929")?.label).toBe("Sonnet 4.5");
    expect(findPrice("claude-opus-5-5[1m]")?.label).toBe("Opus 5.5");
    expect(findPrice("anthropic.claude-opus-5-5")?.label).toBe("Opus 5.5");
    expect(findPrice("claude-opus-4-5@20251101")?.label).toBe("Opus 4.5");
  });
  it("returns null for unknown or synthetic models", () => {
    expect(findPrice("<synthetic>")).toBeNull();
    expect(findPrice("gpt-5")).toBeNull();
  });
});

describe("computeValueUsd", () => {
  it("prices every token category separately", () => {
    // Opus 5.5: 4 in, 20 out, 0.2 read, 5 write5m, 8 write1h per MTok
    const v = computeValueUsd("claude-opus-5-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
    });
    expect(v).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
  });
  it("applies the fast-mode multiplier only where supported", () => {
    const base = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    expect(computeValueUsd("claude-opus-5-5", { ...base, speed: "fast" })).toBeCloseTo(8, 6);
    expect(computeValueUsd("claude-sonnet-5-5", { ...base, speed: "fast" })).toBeCloseTo(2, 6);
  });
  it("uses Haiku 5.5 long-prompt prices above 100k prompt tokens", () => {
    const v = computeValueUsd("claude-haiku-5-5", {
      input: 50_000,
      cacheRead: 60_000,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    expect(v).toBeCloseTo((50_000 * 0.5 + 60_000 * 0.05) / 1e6, 9);
  });
  it("adds web search per-request pricing", () => {
    const v = computeValueUsd("claude-sonnet-5", {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      webSearch: 3,
    });
    expect(v).toBeCloseTo(0.03, 9);
  });
});

describe("detectPlan", () => {
  it("maps rate-limit tiers", () => {
    expect(detectPlan("default_claude_max_20x")).toBe("max20x");
    expect(detectPlan("default_claude_max_5x")).toBe("max5x");
    expect(detectPlan(null)).toBeNull();
  });
});
