import { modelLabel } from "@claude-obs/shared";
import Link from "next/link";
import { DailyStackedSeries } from "@/components/charts";
import { RangePicker } from "@/components/client";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { modelColor, modelOrder } from "@/lib/colors";
import { int, pct, relTime, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { byMachine, dailyByMachine, devicesWithStats, machineModelMix } from "@/lib/queries";
import { RANGES } from "@/lib/range";
import { DeviceActions } from "../settings/forms";

const NONE = "__none__";

export default async function Machines(props: PageProps) {
  const { id, range, tz, role } = await pageContext(props);
  const [devices, usage, mix, daily] = await Promise.all([
    devicesWithStats(id),
    byMachine(id, range.from, range.to),
    machineModelMix(id, range.from, range.to),
    dailyByMachine(id, range.from, range.to, tz),
  ]);

  // Color follows the machine, never its rank: slot by enrollment order, folding past 8 into "other".
  const enrolled = [...devices].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const colorOf = (deviceId: string | null) => {
    const i = deviceId ? enrolled.findIndex((d) => d.id === deviceId) : -1;
    return i >= 0 && i < 8 ? `var(--series-${i + 1})` : "var(--series-other)";
  };
  const nameOf = (deviceId: string | null) => (deviceId ? (devices.find((d) => d.id === deviceId)?.name ?? "Removed machine") : "Not attributed to a machine");
  const total = usage.reduce((s, u) => s + u.value, 0);
  const now = Date.now();

  const series = usage.map((u) => ({ key: u.device_id ?? NONE, label: nameOf(u.device_id), color: colorOf(u.device_id) }));
  const rows = daily.map((d) => ({ day: d.day, key: d.device_id ?? NONE, value: d.value }));
  const idle = devices.filter((d) => !d.revoked_at && !usage.some((u) => u.device_id === d.id));
  const top = usage[0];

  return (
    <>
      <PageHeader title="Machines" sub={`${range.label} · usage by the computer that reported it`}>
        <RangePicker ranges={RANGES} current={range.key} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Machines with usage" value={int(usage.filter((u) => u.device_id).length)} note={`${devices.filter((d) => !d.revoked_at).length} enrolled`} />
        <Stat label="Busiest machine" value={top ? nameOf(top.device_id) : "-"} note={top ? `${usd(top.value)} · ${pct(total ? top.value / total : 0)}` : undefined} />
        <Stat label="API-equivalent value" value={usd(total)} />
        <Stat label="Idle in this range" value={int(idle.length)} note={idle.length ? idle.map((d) => d.name).join(", ") : undefined} />
      </div>

      <Card className="mt-4" title="Daily usage by machine" sub="API-equivalent value per day">
        <DailyStackedSeries rows={rows} series={series} />
      </Card>

      <Card className="mt-4" title="By machine" sub="Rename machines (e.g. “Prakhar – MacBook”) to make this readable.">
        <Table head={["Machine", "Value", "Share", "Requests", "Sessions", "Model mix", "Opus share", "Last active", "Last upload", ""]}>
          {usage.map((u) => {
            const d = devices.find((x) => x.id === u.device_id);
            const models = mix.filter((m) => m.device_id === u.device_id && m.value > 0).sort((a, b) => modelOrder(a.model, b.model));
            const stale = d && !d.revoked_at && (!d.last_seen_at || now - new Date(d.last_seen_at).getTime() > 3 * 86_400_000);
            return (
              <tr key={u.device_id ?? NONE} className="hover:bg-surface-2">
                <Td right={false}>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(u.device_id) }} />
                    {nameOf(u.device_id)}
                    {d?.revoked_at && <Badge>revoked</Badge>}
                    {stale && <Badge tone="warn">⚠ silent</Badge>}
                  </span>
                </Td>
                <Td className="font-medium">{usd(u.value)}</Td>
                <Td>{pct(total ? u.value / total : 0)}</Td>
                <Td>{int(u.requests)}</Td>
                <Td>{int(u.sessions)}</Td>
                <Td>
                  <span
                    className="ml-auto flex h-2 w-28 overflow-hidden rounded-full bg-surface-2"
                    title={models.map((m) => `${modelLabel(m.model)} ${usd(m.value)}`).join(" · ")}
                  >
                    {models.map((m) => (
                      <span key={m.model} style={{ width: `${(m.value / Math.max(u.value, 1e-9)) * 100}%`, background: modelColor(m.model) }} />
                    ))}
                  </span>
                </Td>
                <Td>{pct(u.value ? u.opus_value / u.value : null)}</Td>
                <Td>{relTime(u.last_ts)}</Td>
                <Td>{d ? relTime(d.last_seen_at) : "-"}</Td>
                <Td>{role === "owner" && d && !d.revoked_at && <DeviceActions workspaceId={id} deviceId={d.id} name={d.name} />}</Td>
              </tr>
            );
          })}
          {idle.map((d) => (
            <tr key={d.id} className="text-muted">
              <Td right={false}>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(d.id) }} />
                  {d.name} <Badge>no usage in range</Badge>
                </span>
              </Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>-</Td>
              <Td>{relTime(d.last_seen_at)}</Td>
              <Td>{role === "owner" && <DeviceActions workspaceId={id} deviceId={d.id} name={d.name} />}</Td>
            </tr>
          ))}
        </Table>
        {!usage.length && !idle.length && (
          <p className="py-6 text-center text-sm text-muted">
            No machines yet. <Link href={`/w/${id}/setup`} className="text-accent underline">Connect machines</Link>
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          A machine is a computer (or OS login) running the collector; it isn&apos;t a person. Requests that two machines both reported count once, under the
          first one. claude.ai chat and cloud sessions share the account&apos;s limits but can&apos;t be attributed to any machine.
        </p>
      </Card>
    </>
  );
}
