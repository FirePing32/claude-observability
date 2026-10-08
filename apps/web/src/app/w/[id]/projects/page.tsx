import Link from "next/link";
import { RangePicker } from "@/components/client";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { int, pct, relTime, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { projects } from "@/lib/queries";
import { RANGES } from "@/lib/range";

export default async function Projects(props: PageProps) {
  const { id, range } = await pageContext(props);
  const rows = await projects(id, range.from, range.to);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <>
      <PageHeader title="Projects" sub={`${range.label} · project = folder name Claude Code ran in`}>
        <RangePicker ranges={RANGES} current={range.key} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="Share of value">
          <BarList items={rows.slice(0, 12).map((r) => ({ key: r.project ?? "(none)", label: r.project ?? "(none)", value: r.value }))} format={(v) => `${usd(v)} · ${pct(total ? v / total : 0)}`} />
        </Card>
        <Card className="lg:col-span-2" title="All projects">
          <Table head={["Project", "Sessions", "Requests", "Branches", "Opus share", "Last active", "Value"]}>
            {rows.map((r) => (
              <tr key={r.project ?? "none"} className="hover:bg-surface-2">
                <Td right={false}>
                  {r.project ? (
                    <Link href={`/w/${id}/sessions?project=${encodeURIComponent(r.project)}&range=${range.key}`} className="hover:underline">
                      {r.project}
                    </Link>
                  ) : (
                    <span className="text-muted">(none)</span>
                  )}
                </Td>
                <Td>{int(r.sessions)}</Td>
                <Td>{int(r.requests)}</Td>
                <Td>{int(r.branches)}</Td>
                <Td>{pct(r.value ? r.opus_value / r.value : null)}</Td>
                <Td>{relTime(r.last)}</Td>
                <Td className="font-medium">{usd(r.value)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
