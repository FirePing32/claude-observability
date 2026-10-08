import { describe, expect, it } from "vitest";
import { activeBlock, BLOCK_MS, buildBlocks, learnCeiling, unseenUsageSuspected } from "../src/lib/blocks";

const H = 3600_000;
const t0 = Date.UTC(2026, 9, 1, 9, 17); // 09:17 UTC
const req = (offsetMin: number, value = 1, opus = false) => ({ ts: t0 + offsetMin * 60_000, value, opus });

describe("buildBlocks", () => {
  it("starts a block at the hour of the first request and keeps requests within 5h", () => {
    const b = buildBlocks([req(0), req(60), req(4 * 60 + 40)]);
    expect(b).toHaveLength(1);
    expect(b[0]!.start).toBe(Date.UTC(2026, 9, 1, 9));
    expect(b[0]!.end - b[0]!.start).toBe(BLOCK_MS);
    expect(b[0]!.requests).toBe(3);
  });
  it("opens a new block after the previous one expires; blocks never overlap", () => {
    const b = buildBlocks([req(0), req(5 * 60), req(6 * 60), req(20 * 60)]);
    expect(b.map((x) => x.requests)).toEqual([1, 2, 1]);
    for (let i = 1; i < b.length; i++) expect(b[i]!.start).toBeGreaterThanOrEqual(b[i - 1]!.end);
  });
  it("records value consumed up to the first limit hit", () => {
    const b = buildBlocks([req(0, 10), req(30, 15), req(90, 99)], [{ ts: t0 + 60 * 60_000, kind: "five_hour", resetsAt: null }]);
    expect(b[0]!.valueAtLimit).toBe(25);
    expect(b[0]!.value).toBe(124);
  });
  it("a limit hit with no tracked requests still forms a block", () => {
    const b = buildBlocks([], [{ ts: t0, kind: "five_hour", resetsAt: null }]);
    expect(b).toHaveLength(1);
    expect(b[0]!.valueAtLimit).toBe(0);
  });
});

describe("learnCeiling / activeBlock", () => {
  const limited = (start: number, v: number) => buildBlocks([{ ts: start, value: v, opus: true }], [{ ts: start + 1000, kind: "five_hour", resetsAt: null }])[0]!;
  it("uses the median of values at limit, ignoring weekly hits", () => {
    const blocks = [limited(t0, 30), limited(t0 + 10 * H, 50), limited(t0 + 20 * H, 40)];
    blocks.push(buildBlocks([{ ts: t0 + 30 * H, value: 5, opus: false }], [{ ts: t0 + 30 * H + 1, kind: "weekly", resetsAt: null }])[0]!);
    const c = learnCeiling(blocks)!;
    expect(c.samples).toBe(3);
    expect(c.median).toBe(40);
  });
  it("projects the active block from its burn rate", () => {
    const blocks = buildBlocks([req(0, 10), req(60, 10)]);
    const now = t0 + 60 * 60_000;
    const a = activeBlock(blocks, now, { median: 100, p10: 80, samples: 5 })!;
    expect(a.block.value).toBe(20);
    expect(a.burnPerHour).toBeCloseTo(20, 5);
    expect(a.pctOfCeiling).toBeCloseTo(0.2);
    expect(a.projected).toBeGreaterThan(20);
    expect(activeBlock(blocks, t0 + 6 * H, null)).toBeNull();
  });
  it("flags limit hits far below the conservative ceiling as unseen usage", () => {
    const b = limited(t0, 2);
    expect(unseenUsageSuspected(b, { median: 50, p10: 40, samples: 5 })).toBe(true);
    expect(unseenUsageSuspected(limited(t0, 45), { median: 50, p10: 40, samples: 5 })).toBe(false);
    expect(unseenUsageSuspected(b, { median: 50, p10: 40, samples: 2 })).toBe(false);
  });
});
