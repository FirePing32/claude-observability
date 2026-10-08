import { modelLabel } from "@claude-obs/shared";

/**
 * Color follows the entity, never its rank: each model always gets the same
 * categorical slot, so filters never repaint survivors. Unlisted models fold
 * into "other".
 */
const SLOT_BY_LABEL: Record<string, number> = {
  "Opus 5.5": 1,
  "Opus 5": 2,
  "Sonnet 5.5": 3,
  "Sonnet 5": 4,
  "Sonnet 4.6": 5,
  "Haiku 4.5": 6,
  "Fable 5.1": 7,
  "Fable 5": 7,
  "Opus 4.8": 8,
  "Opus 4.7": 8,
  "Opus 4.6": 8,
};

export function modelColor(model: string): string {
  const slot = SLOT_BY_LABEL[modelLabel(model)];
  return slot ? `var(--series-${slot})` : "var(--series-other)";
}

/** Fixed order for stacking/legends: by slot, then name. */
export function modelOrder(a: string, b: string): number {
  const sa = SLOT_BY_LABEL[modelLabel(a)] ?? 99;
  const sb = SLOT_BY_LABEL[modelLabel(b)] ?? 99;
  return sa - sb || a.localeCompare(b);
}

export const seqColor = (t: number) => {
  if (t <= 0) return "var(--seq-0)";
  const step = Math.min(6, Math.max(1, Math.ceil(t * 6)));
  return `var(--seq-${step})`;
};
