"use client";

import { modelLabel } from "@claude-obs/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { modelColor, modelOrder } from "@/lib/colors";

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--axis)" },
} as const;

const fmtUsd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 10 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
const fmtTok = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function TooltipBox({ title, rows, footer }: { title: string; rows: { key: string; color: string; label: string; value: string }[]; footer?: string }) {
  return (
    <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink-2">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-2 text-ink-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />
            {r.label}
          </span>
          <strong className="tabular text-ink">{r.value}</strong>
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-line pt-1 text-ink-2">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Daily usage stacked by model (value or tokens). */
export function DailyStacked({
  rows,
  metric = "value",
  height = 260,
}: {
  rows: { day: string; model: string; value: number; tokens: number }[];
  metric?: "value" | "tokens";
  height?: number;
}) {
  const models = [...new Set(rows.map((r) => r.model))].sort(modelOrder);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const data = days.map((day) => {
    const o: Record<string, number | string> = { day };
    for (const m of models) o[m] = 0;
    for (const r of rows) if (r.day === day) o[r.model] = (o[r.model] as number) + (metric === "value" ? r.value : r.tokens);
    return o;
  });
  const fmt = metric === "value" ? fmtUsd : fmtTok;
  if (!data.length) return <div className="grid h-40 place-items-center text-sm text-muted">No usage in this range.</div>;
  return (
    <div>
      <Legend items={models.map((m) => ({ key: m, label: modelLabel(m), color: modelColor(m) }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barCategoryGap="20%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} minTickGap={16} />
          <YAxis tickFormatter={fmt} {...axisProps} axisLine={false} width={52} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const items = payload.filter((p) => Number(p.value) > 0).reverse();
              const total = items.reduce((s, p) => s + Number(p.value), 0);
              return (
                <TooltipBox
                  title={fmtDay(String(label))}
                  rows={items.map((p) => ({ key: String(p.dataKey), color: modelColor(String(p.dataKey)), label: modelLabel(String(p.dataKey)), value: fmt(Number(p.value)) }))}
                  footer={`Total ${fmt(total)}`}
                />
              );
            }}
          />
          {models.map((m, i) => (
            <Bar
              key={m}
              dataKey={m}
              stackId="a"
              fill={modelColor(m)}
              stroke="var(--surface)"
              strokeWidth={1}
              maxBarSize={24}
              radius={i === models.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative API-equivalent value through a period, with the plan price as a reference line. */
export function CumulativeValue({ points, planPrice, height = 220 }: { points: { day: string; value: number }[]; planPrice: number; height?: number }) {
  let run = 0;
  const data = points.map((p) => ({ day: p.day, cum: (run += p.value) }));
  if (!data.length) return <div className="grid h-40 place-items-center text-sm text-muted">No usage yet this cycle.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} minTickGap={16} />
        <YAxis tickFormatter={fmtUsd} {...axisProps} axisLine={false} width={52} domain={[0, (max: number) => Math.max(max, planPrice) * 1.1]} />
        <Tooltip
          cursor={{ stroke: "var(--axis)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={fmtDay(String(label))}
                rows={[{ key: "cum", color: "var(--series-1)", label: "Cumulative value", value: fmtUsd(Number(payload[0]!.value)) }]}
                footer={planPrice ? `${(Number(payload[0]!.value) / planPrice).toFixed(1)}× plan price` : undefined}
              />
            ) : null
          }
        />
        {planPrice > 0 && (
          <ReferenceLine y={planPrice} stroke="var(--ink-2)" strokeWidth={1} label={{ value: `Plan price ${fmtUsd(planPrice)}`, fill: "var(--ink-2)", fontSize: 11, position: "insideTopLeft" }} />
        )}
        <Area type="monotone" dataKey="cum" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.1} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface BlockBar {
  start: number;
  end: number;
  value: number;
  requests: number;
  limited: boolean;
  unseen: boolean;
  active: boolean;
}

/** One bar per 5-hour block; blocks that hit a limit are labelled; learned limit as a reference line. */
export function BlocksChart({ blocks, ceiling, tz, height = 240 }: { blocks: BlockBar[]; ceiling: number | null; tz: string; height?: number }) {
  const data = blocks.map((b) => ({
    ...b,
    label: new Date(b.start).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric" }),
    tag: b.limited ? (b.unseen ? "limit ?" : "limit") : b.active ? "now" : "",
  }));
  if (!data.length) return <div className="grid h-40 place-items-center text-sm text-muted">No blocks in this range.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis tickFormatter={fmtUsd} {...axisProps} axisLine={false} width={52} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            if (!p) return null;
            const end = new Date(p.end).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
            return (
              <TooltipBox
                title={`${p.label} → ${end}`}
                rows={[
                  { key: "v", color: "var(--series-1)", label: "Value", value: fmtUsd(p.value) },
                  { key: "r", color: "var(--series-1)", label: "Requests", value: String(p.requests) },
                ]}
                footer={p.limited ? (p.unseen ? "Limit hit with little tracked usage: something unreported used the account" : "Usage limit hit in this block") : p.active ? "Active block" : undefined}
              />
            );
          }}
        />
        {ceiling ? (
          <ReferenceLine y={ceiling} stroke="var(--ink-2)" strokeDasharray="0" label={{ value: `Learned limit ≈ ${fmtUsd(ceiling)}`, fill: "var(--ink-2)", fontSize: 11, position: "insideTopLeft" }} />
        ) : null}
        <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.start} fill={d.active ? "var(--series-1)" : d.limited ? "var(--seq-5)" : "var(--seq-3)"} />
          ))}
          <LabelList dataKey="tag" position="top" style={{ fill: "var(--ink-2)", fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-request context size through a session, with compaction markers. */
export function ContextGrowth({ points, compactions, height = 200 }: { points: { i: number; ts: string; context: number }[]; compactions: number[]; height?: number }) {
  if (points.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="i" {...axisProps} tickFormatter={(i) => `#${i}`} minTickGap={20} />
        <YAxis tickFormatter={fmtTok} {...axisProps} axisLine={false} width={52} />
        <Tooltip
          cursor={{ stroke: "var(--axis)" }}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
            return p ? (
              <TooltipBox
                title={`Request #${p.i} · ${new Date(p.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                rows={[{ key: "c", color: "var(--series-1)", label: "Context tokens", value: fmtTok(p.context) }]}
              />
            ) : null;
          }}
        />
        {compactions.map((i) => (
          <ReferenceLine key={i} x={i} stroke="var(--muted)" label={{ value: "compacted", fill: "var(--muted)", fontSize: 10, position: "insideTop" }} />
        ))}
        <Line type="monotone" dataKey="context" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Value per request, coloured by model. */
export function RequestBars({ points, height = 180 }: { points: { i: number; ts: string; model: string; value: number }[]; height?: number }) {
  const models = [...new Set(points.map((p) => p.model))].sort(modelOrder);
  return (
    <div>
      <Legend items={models.map((m) => ({ key: m, label: modelLabel(m), color: modelColor(m) }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="i" {...axisProps} tickFormatter={(i) => `#${i}`} minTickGap={20} />
          <YAxis tickFormatter={fmtUsd} {...axisProps} axisLine={false} width={52} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
              return p ? (
                <TooltipBox title={`Request #${p.i}`} rows={[{ key: "v", color: modelColor(p.model), label: modelLabel(p.model), value: fmtUsd(p.value) }]} />
              ) : null;
            }}
          />
          <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.i} fill={modelColor(p.model)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  return (
    <div className="mt-2" aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={values.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke="var(--series-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
