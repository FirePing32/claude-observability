import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { listWorkspaces, requireMember } from "@/lib/session";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireMember(id);
  const workspaces = await listWorkspaces(user.id);
  return (
    <div className="lg:flex">
      <Suspense>
        <Nav workspaceId={id} workspaces={workspaces} email={user.email} />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:h-dvh lg:overflow-y-auto lg:px-8 lg:py-7">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
