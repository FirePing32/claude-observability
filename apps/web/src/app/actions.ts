"use server";

import { PLANS, type PlanKey } from "@claude-obs/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ALERT_TYPES, sendTestAlert, validateTarget } from "@/lib/alerts";
import { db, schema } from "@/lib/db";
import { digestConfigured, generateDigest } from "@/lib/digest";
import { isAllowlisted } from "@/lib/access";
import { checkClaudeEmail } from "@/lib/email-check";
import { requireMember, requireUser } from "@/lib/session";
import { newDeviceToken, newHumanCode, newId, newSalt, normalizeCode, sha256 } from "@/lib/tokens";

export type ActionState = { ok?: boolean; error?: string; message?: string; secret?: string } | null;

const planKey = z.enum(Object.keys(PLANS) as [PlanKey, ...PlanKey[]]);
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const workspaceForm = z.object({
  name: z.string().trim().min(1).max(80),
  plan: planKey,
  price: z.coerce.number().min(0).max(100_000),
  timezone: z.string().refine(validTz, "Unknown timezone"),
  billingDay: z.coerce.number().int().min(1).max(28),
});

export async function createWorkspace(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!isAllowlisted(user.email)) return { error: "Only approved leads can create workspaces. Ask an owner to invite you instead." };
  const p = workspaceForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
  const id = newId("ws");
  await db.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values({
      id,
      name: p.data.name,
      ownerId: user.id,
      hashSalt: newSalt(),
      plan: p.data.plan,
      planPriceUsd: p.data.price,
      timezone: p.data.timezone,
      billingDay: p.data.billingDay,
    });
    await tx.insert(schema.memberships).values({ workspaceId: id, userId: user.id, role: "owner" });
    await tx.insert(schema.planPeriods).values({ workspaceId: id, plan: p.data.plan, monthlyPriceUsd: p.data.price, effectiveFrom: new Date().toISOString().slice(0, 10) });
  });
  redirect(`/w/${id}/setup`);
}

export async function updateWorkspace(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { workspace } = await requireMember(wsId, "owner");
  const p = workspaceForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
  await db
    .update(schema.workspaces)
    .set({ name: p.data.name, plan: p.data.plan, planPriceUsd: p.data.price, timezone: p.data.timezone, billingDay: p.data.billingDay })
    .where(eq(schema.workspaces.id, wsId));
  if (p.data.plan !== workspace.plan || p.data.price !== workspace.planPriceUsd) {
    await db.insert(schema.planPeriods).values({ workspaceId: wsId, plan: p.data.plan, monthlyPriceUsd: p.data.price, effectiveFrom: new Date().toISOString().slice(0, 10) });
  }
  revalidatePath(`/w/${wsId}`, "layout");
  return { ok: true, message: "Saved." };
}

export async function createEnrollmentCode(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireMember(wsId, "owner");
  const maxUses = Math.min(20, Math.max(1, Number(form.get("maxUses") ?? 1) || 1));
  const days = Math.min(30, Math.max(1, Number(form.get("days") ?? 7) || 7));
  const label = String(form.get("label") ?? "").slice(0, 80) || null;
  const code = newHumanCode();
  await db.insert(schema.enrollmentCodes).values({
    id: newId("enr"),
    workspaceId: wsId,
    codeHash: sha256(normalizeCode(code)),
    label,
    maxUses,
    expiresAt: new Date(Date.now() + days * 86_400_000),
    createdBy: user.id,
  });
  revalidatePath(`/w/${wsId}/settings`);
  revalidatePath(`/w/${wsId}/setup`);
  return { ok: true, secret: code, message: `Valid for ${maxUses} machine${maxUses > 1 ? "s" : ""}, ${days} day${days > 1 ? "s" : ""}.` };
}

export async function revokeEnrollmentCode(wsId: string, codeId: string) {
  await requireMember(wsId, "owner");
  await db
    .update(schema.enrollmentCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.enrollmentCodes.id, codeId), eq(schema.enrollmentCodes.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function renameDevice(wsId: string, deviceId: string, form: FormData) {
  await requireMember(wsId, "owner");
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  if (!name) return;
  await db.update(schema.devices).set({ name }).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function revokeDevice(wsId: string, deviceId: string) {
  await requireMember(wsId, "owner");
  await db
    .update(schema.devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function inviteMember(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireMember(wsId, "owner");
  const email = z.email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  const role = form.get("role") === "owner" ? "owner" : "viewer";
  if (!email.success) return { error: "Enter a valid Google e-mail address." };
  await db
    .insert(schema.invites)
    .values({ id: newId("inv"), workspaceId: wsId, email: email.data, role, createdBy: user.id })
    .onConflictDoUpdate({ target: [schema.invites.workspaceId, schema.invites.email], set: { role, acceptedAt: null } });
  // if that person already has an account, add them right away
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email.data));
  if (existing) {
    await db.insert(schema.memberships).values({ workspaceId: wsId, userId: existing.id, role }).onConflictDoUpdate({
      target: [schema.memberships.workspaceId, schema.memberships.userId],
      set: { role },
    });
    await db.update(schema.invites).set({ acceptedAt: new Date() }).where(and(eq(schema.invites.workspaceId, wsId), eq(schema.invites.email, email.data)));
  }
  revalidatePath(`/w/${wsId}/settings`);
  return { ok: true, message: existing ? `${email.data} added.` : `Invited ${email.data}. They get access when they sign in with Google.` };
}

export async function removeMember(wsId: string, userId: string) {
  const { workspace, user } = await requireMember(wsId, "owner");
  if (userId === workspace.ownerId || userId === user.id) return;
  await db.delete(schema.memberships).where(and(eq(schema.memberships.workspaceId, wsId), eq(schema.memberships.userId, userId)));
  // drop their invite too, so a removed viewer can't sign back in through it
  const [removed] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  if (removed) await db.delete(schema.invites).where(and(eq(schema.invites.workspaceId, wsId), eq(schema.invites.email, removed.email.toLowerCase())));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function revokeInvite(wsId: string, inviteId: string) {
  await requireMember(wsId, "owner");
  await db.delete(schema.invites).where(and(eq(schema.invites.id, inviteId), eq(schema.invites.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/settings`);
}

/** Device-code flow: an owner approves the CLI's code in the browser. */
export async function decideDevice(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const userCode = normalizeCode(String(form.get("code") ?? ""));
  const wsId = String(form.get("workspaceId") ?? "");
  const decision = form.get("decision") === "deny" ? "deny" : "approve";
  const [req] = await db
    .select()
    .from(schema.deviceAuthRequests)
    .where(and(eq(schema.deviceAuthRequests.userCode, userCode), eq(schema.deviceAuthRequests.status, "pending")));
  if (!req || req.expiresAt < new Date()) return { error: "That code is invalid or expired. Run `claude-obs login` again." };
  if (decision === "deny") {
    await db.update(schema.deviceAuthRequests).set({ status: "denied", approvedBy: user.id }).where(eq(schema.deviceAuthRequests.deviceCodeHash, req.deviceCodeHash));
    return { ok: true, message: "Denied. The CLI will stop waiting." };
  }
  const { workspace } = await requireMember(wsId, "owner");
  const email = await checkClaudeEmail(workspace, { proof: req.accountEmailProof });
  if (email === "mismatch")
    return { error: "That machine is logged into Claude with an e-mail that isn't approved for this workspace. Add it under Settings → Claude account, or log in to Claude there with an approved account." };
  if (email === "missing") return { error: "That machine runs an older claude-obs. Update it (npm install -g claude-obs@latest) and run claude-obs login again." };
  const token = newDeviceToken();
  const deviceId = newId("dev");
  await db.insert(schema.devices).values({ id: deviceId, workspaceId: workspace.id, name: req.name, os: req.os, tokenHash: sha256(token), enrolledVia: "browser" });
  await db
    .update(schema.deviceAuthRequests)
    .set({ status: "approved", approvedBy: user.id, workspaceId: workspace.id, deviceId, pendingToken: token })
    .where(and(eq(schema.deviceAuthRequests.deviceCodeHash, req.deviceCodeHash), eq(schema.deviceAuthRequests.status, "pending")));
  return { ok: true, message: `"${req.name}" is linked to ${workspace.name}. You can close this tab.` };
}

const alertForm = z.object({
  type: z.enum(Object.keys(ALERT_TYPES) as [keyof typeof ALERT_TYPES, ...(keyof typeof ALERT_TYPES)[]]),
  threshold: z.coerce.number().min(0).max(1_000_000),
  channel: z.enum(["email", "slack", "webhook"]),
  target: z.string().trim().min(3).max(500),
});

export async function createAlert(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { user } = await requireMember(wsId, "owner");
  const p = alertForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
  const bad = validateTarget(p.data.channel, p.data.target);
  if (bad) return { error: bad };
  await db.insert(schema.alertRules).values({ id: newId("alr"), workspaceId: wsId, createdBy: user.id, ...p.data });
  revalidatePath(`/w/${wsId}/alerts`);
  return { ok: true, message: "Alert created." };
}

export async function toggleAlert(wsId: string, ruleId: string, enabled: boolean) {
  await requireMember(wsId, "owner");
  await db.update(schema.alertRules).set({ enabled }).where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/alerts`);
}

export async function deleteAlert(wsId: string, ruleId: string) {
  await requireMember(wsId, "owner");
  await db.delete(schema.alertRules).where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/alerts`);
}

export async function testAlert(wsId: string, ruleId: string): Promise<ActionState> {
  const { workspace } = await requireMember(wsId, "owner");
  const [rule] = await db.select().from(schema.alertRules).where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.workspaceId, wsId)));
  if (!rule) return { error: "Not found." };
  const err = await sendTestAlert(rule, workspace.name);
  return err ? { error: `Delivery failed: ${err}` } : { ok: true, message: "Test sent." };
}

/** "I hit a limit": manual marker that also improves the learned limit. */
export async function addManualLimit(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireMember(wsId);
  const when = new Date(String(form.get("when") ?? ""));
  const kind = form.get("kind") === "weekly" ? "weekly" : "five_hour";
  if (Number.isNaN(when.getTime()) || when > new Date()) return { error: "Pick a time in the past." };
  await db.insert(schema.limitEvents).values({ workspaceId: wsId, id: newId("lim"), ts: when, limitKind: kind, source: "manual" });
  revalidatePath(`/w/${wsId}/limits`);
  return { ok: true, message: "Limit hit recorded." };
}

export async function deleteManualLimit(wsId: string, id: string) {
  await requireMember(wsId, "owner");
  await db.delete(schema.limitEvents).where(and(eq(schema.limitEvents.workspaceId, wsId), eq(schema.limitEvents.id, id), eq(schema.limitEvents.source, "manual")));
  revalidatePath(`/w/${wsId}/limits`);
}

export async function generateDigestNow(wsId: string): Promise<ActionState> {
  const { workspace } = await requireMember(wsId, "owner");
  if (!digestConfigured()) return { error: "Set ANTHROPIC_API_KEY on the server to enable AI digests." };
  try {
    await generateDigest(workspace);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/w/${wsId}/insights`);
  return { ok: true, message: "Digest generated." };
}

export async function createShareLink(wsId: string): Promise<ActionState> {
  const { user } = await requireMember(wsId, "owner");
  const token = newDeviceToken().replace(/^cob_/, "shr_");
  await db.insert(schema.shareLinks).values({
    id: newId("shl"),
    workspaceId: wsId,
    tokenHash: sha256(token),
    createdBy: user.id,
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  revalidatePath(`/w/${wsId}/settings`);
  return { ok: true, secret: `/share/${token}`, message: "Read-only overview link, valid for 30 days." };
}

export async function revokeShareLink(wsId: string, id: string) {
  await requireMember(wsId, "owner");
  await db.update(schema.shareLinks).set({ revokedAt: new Date() }).where(and(eq(schema.shareLinks.id, id), eq(schema.shareLinks.workspaceId, wsId)));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function updateClaudeEmailPolicy(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireMember(wsId, "owner");
  const require = form.get("requireEmailMatch") === "on";
  const raw = String(form.get("extraClaudeEmails") ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const bad = raw.filter((e) => !z.email().safeParse(e).success);
  if (bad.length) return { error: `Not valid e-mail addresses: ${bad.join(", ")}` };
  if (raw.length > 50) return { error: "At most 50 extra e-mails." };
  await db
    .update(schema.workspaces)
    .set({ requireEmailMatch: require, extraClaudeEmails: [...new Set(raw)] })
    .where(eq(schema.workspaces.id, wsId));
  revalidatePath(`/w/${wsId}/settings`);
  return { ok: true, message: "Saved." };
}

export async function resetAccountPin(wsId: string) {
  await requireMember(wsId, "owner");
  await db.update(schema.workspaces).set({ accountHash: null, detectedTier: null }).where(eq(schema.workspaces.id, wsId));
  revalidatePath(`/w/${wsId}/settings`);
}

export async function deleteWorkspace(wsId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { workspace, user } = await requireMember(wsId, "owner");
  if (workspace.ownerId !== user.id) return { error: "Only the workspace creator can delete it." };
  if (String(form.get("confirm") ?? "") !== workspace.name) return { error: "Type the workspace name exactly to confirm." };
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsId));
  redirect("/");
}
