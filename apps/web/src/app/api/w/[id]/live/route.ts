import { liveBlock } from "@/lib/live";
import { requireMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireMember(id);
  return Response.json(await liveBlock(id), { headers: { "cache-control": "no-store" } });
}
