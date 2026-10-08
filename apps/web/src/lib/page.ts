import "server-only";
import { resolveRange } from "./range";
import { requireMember } from "./session";

export type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Common per-page context: membership check + range + filters from the URL. */
export async function pageContext({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const m = await requireMember(id);
  const range = resolveRange(sp.range, m.workspace.billingDay);
  return { ...m, id, sp, range, tz: m.workspace.timezone, filters: { model: sp.model ?? null, project: sp.project ?? null } };
}
