/**
 * Reconstructs Claude subscription "5-hour blocks" from request timestamps.
 * Anthropic describes usage limits as 5-hour sessions that start with your first
 * message; exact reset rules are not published, so this is a model: a block
 * starts at the first activity after the previous block expired (rounded down to
 * the hour) and lasts 5 hours. Everything here is account-wide.
 */

export const BLOCK_MS = 5 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export interface ReqPoint {
  ts: number;
  value: number;
  opus: boolean;
}
export interface LimitPoint {
  ts: number;
  kind: string;
  resetsAt: number | null;
}

export interface Block {
  start: number;
  end: number;
  firstTs: number;
  lastTs: number;
  requests: number;
  value: number;
  opusValue: number;
  limits: LimitPoint[];
  /** Tracked value consumed up to the first limit hit in this block. */
  valueAtLimit: number | null;
}

export function buildBlocks(requests: ReqPoint[], limits: LimitPoint[] = [], roundToHour = true): Block[] {
  type Ev = { ts: number; req?: ReqPoint; limit?: LimitPoint };
  const events: Ev[] = [
    ...requests.map((req) => ({ ts: req.ts, req })),
    ...limits.map((limit) => ({ ts: limit.ts, limit })),
  ].sort((a, b) => a.ts - b.ts);

  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const e of events) {
    if (!cur || e.ts >= cur.end) {
      const start = roundToHour ? Math.floor(e.ts / HOUR) * HOUR : e.ts;
      cur = { start, end: start + BLOCK_MS, firstTs: e.ts, lastTs: e.ts, requests: 0, value: 0, opusValue: 0, limits: [], valueAtLimit: null };
      blocks.push(cur);
    }
    cur.lastTs = e.ts;
    if (e.req) {
      cur.requests++;
      cur.value += e.req.value;
      if (e.req.opus) cur.opusValue += e.req.value;
    } else if (e.limit) {
      if (cur.valueAtLimit === null) cur.valueAtLimit = cur.value;
      cur.limits.push(e.limit);
    }
  }
  return blocks;
}

export interface Ceiling {
  /** Median tracked value at which a 5-hour limit was hit. */
  median: number;
  /** Conservative (10th percentile) ceiling. */
  p10: number;
  samples: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Learned from this account's own limit hits; ignores weekly-limit hits and near-empty blocks. */
export function learnCeiling(blocks: Block[], minValue = 1): Ceiling | null {
  const vals = blocks
    .filter((b) => b.valueAtLimit !== null && b.limits.some((l) => l.kind !== "weekly") && b.valueAtLimit >= minValue)
    .map((b) => b.valueAtLimit!)
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  return { median: quantile(vals, 0.5), p10: quantile(vals, 0.1), samples: vals.length };
}

export interface ActiveBlock {
  block: Block;
  elapsedMs: number;
  remainingMs: number;
  /** $ per hour over the block so far (min 15-minute denominator to avoid early spikes). */
  burnPerHour: number;
  projected: number;
  pctOfCeiling: number | null;
  projectedPctOfCeiling: number | null;
}

export function activeBlock(blocks: Block[], now: number, ceiling: Ceiling | null): ActiveBlock | null {
  const b = blocks[blocks.length - 1];
  if (!b || now >= b.end || now < b.start) return null;
  const elapsedMs = now - b.start;
  const remainingMs = b.end - now;
  const burnPerHour = b.value / (Math.max(now - b.firstTs, 15 * 60 * 1000) / HOUR);
  const projected = b.value + (burnPerHour * remainingMs) / HOUR;
  return {
    block: b,
    elapsedMs,
    remainingMs,
    burnPerHour,
    projected,
    pctOfCeiling: ceiling ? b.value / ceiling.median : null,
    projectedPctOfCeiling: ceiling ? projected / ceiling.median : null,
  };
}

/**
 * A limit hit while tracked usage was below the conservative ceiling suggests
 * usage we can't see: an un-enrolled machine, cloud sessions or claude.ai chat.
 */
export function unseenUsageSuspected(b: Block, ceiling: Ceiling | null): boolean {
  if (!ceiling || ceiling.samples < 3 || b.valueAtLimit === null) return false;
  return b.valueAtLimit < ceiling.p10 * 0.6;
}
