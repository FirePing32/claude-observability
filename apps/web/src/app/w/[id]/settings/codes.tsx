import { desc, eq } from "drizzle-orm";
import { revokeEnrollmentCode } from "@/app/actions";
import { Badge, Card, Table, Td } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { dateTime, relTime } from "@/lib/format";
import { SmallAction } from "./forms";

/** Enrollment codes for a workspace. Codes are stored hashed; the fingerprint is the start of that hash. */
export async function EnrollmentCodes({ workspaceId, tz, owner }: { workspaceId: string; tz: string; owner: boolean }) {
  if (!owner) return null;
  const codes = await db
    .select({ code: schema.enrollmentCodes, creator: schema.user.name, creatorEmail: schema.user.email })
    .from(schema.enrollmentCodes)
    .leftJoin(schema.user, eq(schema.user.id, schema.enrollmentCodes.createdBy))
    .where(eq(schema.enrollmentCodes.workspaceId, workspaceId))
    .orderBy(desc(schema.enrollmentCodes.createdAt))
    .limit(50);
  const now = Date.now();
  const status = (c: typeof schema.enrollmentCodes.$inferSelect) =>
    c.revokedAt
      ? { label: "revoked", tone: "neutral" as const, active: false }
      : c.expiresAt.getTime() < now
        ? { label: "expired", tone: "neutral" as const, active: false }
        : c.uses >= c.maxUses
          ? { label: "used up", tone: "neutral" as const, active: false }
          : { label: "active", tone: "good" as const, active: true };
  const active = codes.filter((r) => status(r.code).active).length;

  return (
    <Card
      className="mt-4"
      title="Enrollment codes"
      sub={`${active} active. Codes are stored only as hashes, so they can't be shown again; the fingerprint identifies each one.`}
    >
      <Table head={["Fingerprint", "Label", "Created", "Uses", "Expires", "Status", ""]}>
        {codes.map(({ code: c, creator, creatorEmail }) => {
          const st = status(c);
          return (
            <tr key={c.id} className={st.active ? "" : "text-muted"}>
              <Td right={false} className="font-mono text-xs">
                #{c.codeHash.slice(0, 8)}
              </Td>
              <Td>{c.label ?? "-"}</Td>
              <Td>
                <span title={creatorEmail ?? undefined}>
                  {relTime(c.createdAt)}
                  {creator ? ` · ${creator}` : ""}
                </span>
              </Td>
              <Td>
                {c.uses}/{c.maxUses}
              </Td>
              <Td>{c.revokedAt ? "-" : dateTime(c.expiresAt, tz)}</Td>
              <Td>
                <Badge tone={st.tone}>{st.label}</Badge>
              </Td>
              <Td>
                {st.active && (
                  <SmallAction
                    label="Revoke"
                    confirmText={`Revoke code #${c.codeHash.slice(0, 8)}? Machines already linked with it keep working.`}
                    run={revokeEnrollmentCode.bind(null, workspaceId, c.id)}
                  />
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      {!codes.length && <p className="py-6 text-center text-sm text-muted">No codes yet.</p>}
      <p className="mt-3 text-xs text-muted">Revoking a code stops new machines from using it. Machines already linked keep working; revoke those under Machines.</p>
    </Card>
  );
}
