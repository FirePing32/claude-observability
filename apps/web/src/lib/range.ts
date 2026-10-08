export const RANGES = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  cycle: "This billing cycle",
  mtd: "Month to date",
  all: "All time",
} as const;
export type RangeKey = keyof typeof RANGES;

export interface Range {
  key: RangeKey;
  label: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

const DAY = 86_400_000;

/** Start of the current billing cycle given the day-of-month the plan renews. */
export function cycleStart(now: Date, billingDay: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(billingDay, 28)));
  if (d > now) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

export function resolveRange(key: string | undefined, billingDay = 1, now = new Date()): Range {
  const k: RangeKey = key && key in RANGES ? (key as RangeKey) : "30d";
  let from: Date;
  switch (k) {
    case "24h":
      from = new Date(now.getTime() - DAY);
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * DAY);
      break;
    case "90d":
      from = new Date(now.getTime() - 90 * DAY);
      break;
    case "mtd":
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case "cycle":
      from = cycleStart(now, billingDay);
      break;
    case "all":
      from = new Date(Date.UTC(2023, 0, 1));
      break;
    default:
      from = new Date(now.getTime() - 30 * DAY);
  }
  const span = now.getTime() - from.getTime();
  return {
    key: k,
    label: RANGES[k],
    from,
    to: now,
    prevFrom: new Date(from.getTime() - span),
    prevTo: from,
  };
}
