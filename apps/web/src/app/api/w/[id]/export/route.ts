import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveRange } from "@/lib/range";
import { requireMember } from "@/lib/session";

const COLS = ["ts", "session_id", "request_id", "model", "is_subagent", "agent_type", "input", "output", "cache_read", "cache_write_5m", "cache_write_1h", "value_usd", "project", "git_branch", "entrypoint", "effort", "speed"] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // neutralize spreadsheet formula injection and quote when needed
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMember(id);
  const range = resolveRange(new URL(req.url).searchParams.get("range") ?? "30d", workspace.billingDay);
  const rows = (await db.execute(sql`
    select ts, session_id, request_id, model, is_subagent, agent_type, input, output, cache_read, cache_write_5m, cache_write_1h,
      value_usd, project, git_branch, entrypoint, effort, speed
    from api_requests where workspace_id = ${id} and ts >= ${range.from.toISOString()}::timestamptz and ts < ${range.to.toISOString()}::timestamptz order by ts`)) as unknown as Record<string, unknown>[];
  const body = [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="claude-usage-${range.key}.csv"`,
    },
  });
}
