import { desc, eq } from "drizzle-orm";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { ALERT_TYPES } from "@/lib/alerts";
import { db, schema } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { AlertForm, AlertRowActions } from "./forms";

export default async function Alerts(props: PageProps) {
  const { id, role, tz } = await pageContext(props);
  const [rules, events] = await Promise.all([
    db.select().from(schema.alertRules).where(eq(schema.alertRules.workspaceId, id)).orderBy(schema.alertRules.createdAt),
    db.select().from(schema.alertEvents).where(eq(schema.alertEvents.workspaceId, id)).orderBy(desc(schema.alertEvents.firedAt)).limit(30),
  ]);
  const owner = role === "owner";
  return (
    <>
      <PageHeader title="Alerts" sub="Checked after every upload, plus a daily sweep; each block or period alerts once." />
      {owner && (
        <Card title="New alert">
          <AlertForm workspaceId={id} types={Object.fromEntries(Object.entries(ALERT_TYPES).map(([k, v]) => [k, v.label]))} />
        </Card>
      )}
      <Card className="mt-4" title="Rules">
        <Table head={["Condition", "Threshold", "Channel", "Status", ""]}>
          {rules.map((r) => (
            <tr key={r.id}>
              <Td right={false}>{ALERT_TYPES[r.type].label}</Td>
              <Td>
                {ALERT_TYPES[r.type].unit === "$" ? `$${r.threshold}` : ALERT_TYPES[r.type].unit === "%" ? `${r.threshold}%` : r.type === "limit_hit" ? "-" : `${r.threshold} ${ALERT_TYPES[r.type].unit}`}
              </Td>
              <Td>
                {r.channel} · <span className="text-muted">{r.channel === "email" ? r.target : new URL(r.target).hostname}</span>
              </Td>
              <Td>{r.enabled ? <Badge tone="good">on</Badge> : <Badge>off</Badge>}</Td>
              <Td>{owner && <AlertRowActions workspaceId={id} ruleId={r.id} enabled={r.enabled} />}</Td>
            </tr>
          ))}
        </Table>
        {!rules.length && <p className="py-6 text-center text-sm text-muted">No alerts yet.</p>}
      </Card>
      <Card className="mt-4" title="Recent alerts">
        <Table head={["When", "Message", "Delivery"]}>
          {events.map((e) => (
            <tr key={e.id}>
              <Td right={false}>{dateTime(e.firedAt, tz)}</Td>
              <Td right={false} className="whitespace-normal">
                {e.message}
              </Td>
              <Td>{e.delivered ? <Badge tone="good">sent</Badge> : <Badge tone="bad">{e.error ?? "failed"}</Badge>}</Td>
            </tr>
          ))}
        </Table>
        {!events.length && <p className="py-6 text-center text-sm text-muted">Nothing has fired yet.</p>}
      </Card>
    </>
  );
}
