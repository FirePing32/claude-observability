import { and, eq, isNull } from "drizzle-orm";
import { Badge, Card, Code, PageHeader, Table, Td } from "@/components/ui";
import { WorkspaceForm } from "@/components/forms/workspace-form";
import { removeMember, resetAccountPin, revokeEnrollmentCode, revokeInvite, revokeShareLink, updateWorkspace } from "@/app/actions";
import { db, schema } from "@/lib/db";
import { dateTime, int, relTime, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { dataQuality, devicesWithStats } from "@/lib/queries";
import { DeleteWorkspaceForm, DeviceActions, InviteForm, ShareLinkButton, SmallAction } from "./forms";

export default async function Settings(props: PageProps) {
  const { id, workspace: ws, role, user, tz } = await pageContext(props);
  const owner = role === "owner";
  const [members, invites, devices, codes, links, dq] = await Promise.all([
    db
      .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(eq(schema.memberships.workspaceId, id)),
    db.select().from(schema.invites).where(and(eq(schema.invites.workspaceId, id), isNull(schema.invites.acceptedAt))),
    devicesWithStats(id),
    db.select().from(schema.enrollmentCodes).where(and(eq(schema.enrollmentCodes.workspaceId, id), isNull(schema.enrollmentCodes.revokedAt))),
    db.select().from(schema.shareLinks).where(and(eq(schema.shareLinks.workspaceId, id), isNull(schema.shareLinks.revokedAt))),
    dataQuality(id),
  ]);
  const now = Date.now();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Workspace & plan" sub="Plan price drives the value multiple; renewal day defines billing cycles.">
          {owner ? (
            <WorkspaceForm
              action={updateWorkspace.bind(null, id)}
              submitLabel="Save"
              initial={{ name: ws.name, plan: ws.plan, price: ws.planPriceUsd, timezone: ws.timezone, billingDay: ws.billingDay }}
            />
          ) : (
            <p className="text-sm text-ink-2">Only owners can change these.</p>
          )}
        </Card>
        <Card title="Claude account" sub="Uploads are pinned to one Claude account so another account can't skew the totals.">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>{ws.accountHash ? <Badge tone="good">pinned</Badge> : <Badge>waiting for first upload</Badge>}</dd>
            <dt className="text-muted">Detected tier</dt>
            <dd>{ws.detectedTier ? <Code>{ws.detectedTier}</Code> : "-"}</dd>
            <dt className="text-muted">Account id</dt>
            <dd className="text-xs text-ink-2">Stored only as a salted hash; the Claude login itself never leaves your machines.</dd>
          </dl>
          {owner && ws.accountHash && (
            <div className="mt-3">
              <SmallAction label="Re-pin to the next uploading account" run={resetAccountPin.bind(null, id)} confirmText="Use this if you moved to a different Claude account. Continue?" />
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Machines" sub="Every computer reporting usage for this account">
        <div id="machines" />
        <Table head={["Machine", "System", "Claude Code", "Enrolled", "Last upload", "Last 7 days", ""]}>
          {devices.map((d) => {
            const stale = !d.revoked_at && (!d.last_seen_at || now - new Date(d.last_seen_at).getTime() > 3 * 86_400_000);
            return (
              <tr key={d.id} className={d.revoked_at ? "opacity-50" : ""}>
                <Td right={false}>
                  {d.name} {d.revoked_at ? <Badge>revoked</Badge> : stale ? <Badge tone="warn">⚠ silent</Badge> : null}
                </Td>
                <Td>{d.os ?? "-"}</Td>
                <Td>{d.cc_versions.at(-1) ?? "-"}</Td>
                <Td>{dateTime(d.created_at, tz)}</Td>
                <Td>{relTime(d.last_seen_at)}</Td>
                <Td>
                  {int(d.requests_7d)} req · {usd(d.value_7d)}
                </Td>
                <Td>{owner && !d.revoked_at && <DeviceActions workspaceId={id} deviceId={d.id} name={d.name} />}</Td>
              </tr>
            );
          })}
        </Table>
        {!devices.length && <p className="py-6 text-center text-sm text-muted">No machines yet. See Connect machines.</p>}
        {owner && codes.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium text-ink-2">Active enrollment codes</div>
            <Table head={["Label", "Used", "Expires", ""]}>
              {codes.map((c) => (
                <tr key={c.id}>
                  <Td right={false}>{c.label ?? "-"}</Td>
                  <Td>
                    {c.uses}/{c.maxUses}
                  </Td>
                  <Td>{c.expiresAt.getTime() < now ? "expired" : dateTime(c.expiresAt, tz)}</Td>
                  <Td>
                    <SmallAction label="Revoke" run={revokeEnrollmentCode.bind(null, id, c.id)} />
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="People with access" sub="Dashboard access only; everyone sees account-level numbers.">
          <Table head={["Person", "Role", ""]}>
            {members.map((m) => (
              <tr key={m.userId}>
                <Td right={false}>
                  {m.name} <span className="text-muted">{m.email}</span>
                </Td>
                <Td>{m.role}</Td>
                <Td>{owner && m.userId !== user.id && m.userId !== ws.ownerId && <SmallAction label="Remove" run={removeMember.bind(null, id, m.userId)} confirmText={`Remove ${m.email}?`} />}</Td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.id}>
                <Td right={false}>
                  <span className="text-muted">{i.email}</span> <Badge>invited</Badge>
                </Td>
                <Td>{i.role}</Td>
                <Td>{owner && <SmallAction label="Cancel" run={revokeInvite.bind(null, id, i.id)} />}</Td>
              </tr>
            ))}
          </Table>
          {owner && (
            <div className="mt-4">
              <InviteForm workspaceId={id} />
            </div>
          )}
        </Card>
        <Card title="Data quality" sub="Last 30 days">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-ink-2">Requests seen by transcripts and telemetry</dt>
            <dd className="tabular">{int(dq.both)}</dd>
            <dt className="text-ink-2">Transcript only</dt>
            <dd className="tabular">{int(dq.transcript_only)}</dd>
            <dt className="text-ink-2">Telemetry only (side requests transcripts miss)</dt>
            <dd className="tabular">{int(dq.otel_only)}</dd>
            <dt className="text-ink-2">Requests with unpriced models</dt>
            <dd className="tabular">{int(dq.unpriced)}</dd>
            <dt className="text-ink-2">Last upload</dt>
            <dd>{relTime(dq.last_ingest)}</dd>
          </dl>
          {dq.unknown.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Unrecognized transcript record types (ignored safely): {dq.unknown.map((u) => `${u.k}×${u.n}`).join(", ")}
            </p>
          )}
        </Card>
      </div>

      {owner && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Share a read-only overview" sub="Anyone with the link sees the overview numbers (no session titles).">
            <ShareLinkButton workspaceId={id} />
            {links.length > 0 && (
              <Table className="mt-3" head={["Created", "Expires", ""]}>
                {links.map((l) => (
                  <tr key={l.id}>
                    <Td right={false}>{dateTime(l.createdAt, tz)}</Td>
                    <Td>{l.expiresAt ? dateTime(l.expiresAt, tz) : "never"}</Td>
                    <Td>
                      <SmallAction label="Revoke" run={revokeShareLink.bind(null, id, l.id)} />
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Danger zone">
            <DeleteWorkspaceForm workspaceId={id} name={ws.name} />
          </Card>
        </div>
      )}
    </>
  );
}
