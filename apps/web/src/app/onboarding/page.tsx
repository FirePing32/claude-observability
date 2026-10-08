import { createWorkspace } from "@/app/actions";
import { WorkspaceForm } from "@/components/forms/workspace-form";
import { isAllowlisted } from "@/lib/access";
import { requireUser } from "@/lib/session";

export default async function Onboarding() {
  const user = await requireUser();
  if (!isAllowlisted(user.email)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">No workspace yet</h1>
        <p className="mt-2 text-sm text-ink-2">
          Signed in as {user.email}. Creating workspaces is limited to approved leads. Ask the administrator to approve this e-mail.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="text-sm font-medium text-accent">Step 1 of 2</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set up your Claude account</h1>
      <p className="mt-2 text-sm text-ink-2">
        A workspace tracks one Claude subscription. Every machine
        that runs Claude Code on it reports into it. Signed in as {user.email}.
      </p>
      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <WorkspaceForm action={createWorkspace} submitLabel="Create workspace" />
      </div>
    </main>
  );
}
