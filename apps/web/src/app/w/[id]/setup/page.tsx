import { DEFAULT_COLLECTOR_SERVER } from "@claude-obs/shared";
import { headers } from "next/headers";
import { CommandBlock, WaitForData } from "@/components/client";
import { Card, Code, PageHeader } from "@/components/ui";
import { pageContext, type PageProps } from "@/lib/page";
import { dataQuality } from "@/lib/queries";
import { EnrollmentCodes } from "../settings/codes";
import { EnrollCodeForm } from "../settings/forms";

export default async function Setup(props: PageProps) {
  const { id, role, tz } = await pageContext(props);
  const h = await headers();
  const origin = process.env.BETTER_AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const dq = await dataQuality(id);
  // The collector already defaults to the production URL; only spell out --server for other deployments.
  const serverFlag = origin.replace(/\/+$/, "") === DEFAULT_COLLECTOR_SERVER ? "" : ` --server ${origin}`;
  return (
    <>
      <PageHeader title="Connect machines" sub="Do this once on every computer where anyone runs Claude Code with this account." />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="1 · Get an enrollment code" sub="One code can enroll several machines; send it to whoever runs Claude Code on them.">
            {role === "owner" ? <EnrollCodeForm workspaceId={id} serverFlag={serverFlag} /> : <p className="text-sm text-ink-2">Ask a workspace owner for a code.</p>}
          </Card>
          <Card title="2 · On each machine" sub="Needs Node 20+. The collector reads ~/.claude locally and uploads usage numbers only.">
            <div className="space-y-2">
              <CommandBlock command="npm install -g claude-obs" />
              <CommandBlock command={`claude-obs login --code XXXX-XXXX${serverFlag}`} />
              <CommandBlock command="claude-obs sync" />
              <CommandBlock command="claude-obs install-agent" />
            </div>
            <p className="mt-3 text-xs text-ink-2">
              <Code>sync</Code> uploads all history; <Code>install-agent</Code> keeps it live in the background (launchd on macOS, systemd on Linux,
              Task Scheduler on Windows). Want to check first? <Code>claude-obs sync --dry-run</Code> prints exactly what would be sent.
            </p>
          </Card>
          <Card title="3 · Optional: live telemetry for exact totals" sub="Claude Code's own OpenTelemetry adds side requests that never reach transcripts (about 5–10% more), plus latency.">
            <CommandBlock command="claude-obs otel --install" />
            <p className="mt-2 text-xs text-ink-2">
              Adds the OpenTelemetry settings (with this machine's token) to <Code>~/.claude/settings.json</Code>, so it applies to the CLI and the desktop app.
              Use <Code>claude-obs otel --print</Code> to see the block without writing it.
            </p>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Status">
            <WaitForData workspaceId={id} hasData={Boolean(dq.last_ingest)} />
          </Card>
          <Card title="What gets uploaded">
            <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2">
              <li>Per request: ids, time, model, token counts, effort, speed, subagent/skill names</li>
              <li>Project folder name (or a hash) and git branch</li>
              <li>Session titles (switch off with <Code>claude-obs config titles off</Code>)</li>
              <li>Error categories and usage-limit hits</li>
              <li>A one-way hash of the Claude login e-mail, checked against this workspace&apos;s approved e-mails and never stored</li>
            </ul>
            <p className="mt-3 text-sm text-ink-2">
              <strong className="text-ink">Never:</strong> prompts, responses, thinking, code, file contents, tool input/output, full paths, or your Claude login.
            </p>
          </Card>
        </div>
      </div>
      <EnrollmentCodes workspaceId={id} tz={tz} owner={role === "owner"} />
    </>
  );
}
