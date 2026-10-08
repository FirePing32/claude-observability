import "server-only";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { db, schema } from "./db";

export type Role = "owner" | "viewer";

export const getUser = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
});

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Membership check for every workspace page and action. Viewers are read-only. */
export const requireMember = cache(async (workspaceId: string, need: Role = "viewer") => {
  const user = await requireUser();
  const rows = await db
    .select({ workspace: schema.workspaces, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();
  if (need === "owner" && row.role !== "owner") throw new Error("Only workspace owners can do that.");
  return { user, workspace: row.workspace, role: row.role as Role };
});

export async function listWorkspaces(userId: string) {
  return db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(schema.workspaces.createdAt);
}
