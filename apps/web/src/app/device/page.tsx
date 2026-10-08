import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { getUser, listWorkspaces } from "@/lib/session";
import { normalizeCode } from "@/lib/tokens";
import { DeviceDecision } from "./decision";

export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = "" } = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/device?code=${code}`)}`);
  const owned = (await listWorkspaces(user.id)).filter((w) => w.role === "owner");
  const [req] = code
    ? await db
        .select()
        .from(schema.deviceAuthRequests)
        .where(and(eq(schema.deviceAuthRequests.userCode, normalizeCode(code)), eq(schema.deviceAuthRequests.status, "pending")))
    : [];
  const valid = req && req.expiresAt > new Date();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Link a machine</h1>
      {!valid ? (
        <p className="mt-3 text-sm text-ink-2">This code is invalid or expired. Run <code>claude-obs login</code> again on the machine.</p>
      ) : !owned.length ? (
        <p className="mt-3 text-sm text-ink-2">You need to own a workspace to link machines. Create one first.</p>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-surface p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Code</dt>
            <dd className="font-mono">{req.userCode}</dd>
            <dt className="text-muted">Machine</dt>
            <dd>{req.name}</dd>
            <dt className="text-muted">System</dt>
            <dd>{req.os}</dd>
            <dt className="text-muted">From IP</dt>
            <dd>{req.ip}</dd>
          </dl>
          <p className="mt-3 text-xs text-ink-2">Only approve if you just ran <code>claude-obs login</code> and the code matches.</p>
          <DeviceDecision code={req.userCode} workspaces={owned.map((w) => ({ id: w.id, name: w.name }))} />
        </div>
      )}
    </main>
  );
}
