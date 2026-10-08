import { createWorkspace } from "@/app/actions";
import { WorkspaceForm } from "@/components/forms/workspace-form";
import { requireUser } from "@/lib/session";

export default async function Onboarding() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="text-sm font-medium text-accent">Step 1 of 2</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set up your Claude account</h1>
      <p className="mt-2 text-sm text-ink-2">
        A workspace tracks one Claude subscription. Everyone who uses that subscription can be invited to view it, and every machine
        that runs Claude Code on it reports into it. Signed in as {user.email}.
      </p>
      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <WorkspaceForm action={createWorkspace} submitLabel="Create workspace" />
      </div>
    </main>
  );
}
