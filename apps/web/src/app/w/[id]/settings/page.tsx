import { Badge, Card, Code, PageHeader, Table, Td } from "@/components/ui";
import { WorkspaceForm } from "@/components/forms/workspace-form";
import { resetAccountPin, updateWorkspace } from "@/app/actions";
import { dateTime, int, relTime, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { dataQuality, devicesWithStats } from "@/lib/queries";
import { allowedClaudeEmails } from "@/lib/email-check";
import { EnrollmentCodes } from "./codes";
import { ClaudeEmailPolicyForm, DeleteWorkspaceForm, DeviceActions, SmallAction } from "./forms";

export default async function Settings(props: PageProps) {
  const { id, workspace: ws, role, tz } = await pageContext(props);
  const owner = role === "owner";
  const [devices, dq, approvedEmails] = await Promise.all([
    devicesWithStats(id),
    dataQuality(id),
    allowedClaudeEmails(ws),
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
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 text-xs font-medium text-ink-2">
              Claude account e-mail check:{" "}
              {ws.requireEmailMatch ? <Badge tone="good">on</Badge> : <Badge tone="warn">off</Badge>}
              {ws.requireEmailMatch && <span className="ml-2 text-muted">approved: {approvedEmails.join(", ") || "none"}</span>}
            </div>
            {owner && <ClaudeEmailPolicyForm workspaceId={id} require={ws.requireEmailMatch} extra={ws.extraClaudeEmails} />}
            <p className="mt-2 text-xs text-muted">
              Machines send only a one-way hash of their Claude login e-mail; it is compared and discarded, never stored. This stops mistakes and casual
              misuse; the enrollment code and per-machine token remain the real lock.
            </p>
          </div>
          {owner && ws.accountHash && (
            <div className="mt-3">
              <SmallAction label="Re-pin to the next uploading account" run={resetAccountPin.bind(null, id)} confirmText="Use this if you moved to a different Claude account. Continue?" />
            </div>
          )}
        </Card>
      </div>

      <Card
        className="mt-4"
        title="Machines"
        sub="Every computer reporting usage for this account"
        action={<a href={`/w/${id}/machines`} className="text-xs text-accent">Usage by machine →</a>}
      >
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
      </Card>

      <EnrollmentCodes workspaceId={id} tz={tz} owner={owner} />

      <Card className="mt-4" title="Data quality" sub="Last 30 days">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Seen by transcripts and telemetry", value: int(dq.both) },
            { label: "Transcripts only", value: int(dq.transcript_only) },
            { label: "Telemetry only", value: int(dq.otel_only), hint: "side requests transcripts miss" },
            { label: "Unpriced models", value: int(dq.unpriced) },
            { label: "Last upload", value: relTime(dq.last_ingest) },
          ].map((m) => (
            <div key={m.label} className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-ink-2">{m.label}</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{m.value}</dd>
              {m.hint && <dd className="text-[11px] text-muted">{m.hint}</dd>}
            </div>
          ))}
        </dl>
        {dq.both + dq.otel_only === 0 && dq.transcript_only > 0 && (
          <p className="mt-3 text-xs text-muted">
            Telemetry isn&apos;t enabled on any machine yet. Run <Code>claude-obs otel --install</Code> on each machine for exact totals.
          </p>
        )}
        {dq.unknown.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Unrecognized transcript record types (ignored safely): {dq.unknown.map((u) => `${u.k}×${u.n}`).join(", ")}
          </p>
        )}
      </Card>

      {owner && (
        <Card className="mt-4" title="Danger zone">
          <DeleteWorkspaceForm workspaceId={id} name={ws.name} />
        </Card>
      )}
    </>
  );
}
