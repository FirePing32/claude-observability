"use client";

import { Activity, Bell, Boxes, FolderGit2, Gauge, Laptop, Layers, Lightbulb, LogOut, PiggyBank, Plug, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const ITEMS = [
  { href: "", label: "Overview", icon: Gauge },
  { href: "/sessions", label: "Sessions", icon: Activity },
  { href: "/models", label: "Models", icon: Boxes },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/machines", label: "Machines", icon: Laptop },
  { href: "/limits", label: "Limits", icon: Layers },
  { href: "/value", label: "Plan value", icon: PiggyBank },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/setup", label: "Connect machines", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ workspaceId, workspaces, email }: { workspaceId: string; workspaces: { id: string; name: string }[]; email: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const base = `/w/${workspaceId}`;
  const range = params.get("range");
  const keep = range ? `?range=${range}` : "";
  return (
    <nav className="flex flex-col gap-4 lg:h-dvh lg:w-56 lg:shrink-0 lg:border-r lg:border-line lg:bg-surface lg:p-4">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 lg:px-0 lg:pt-0">
        <Link href={base} className="text-sm font-semibold">
          Claude Observability
        </Link>
      </div>
      {workspaces.length > 1 ? (
        <select
          aria-label="Workspace"
          value={workspaceId}
          onChange={(e) => router.push(`/w/${e.target.value}`)}
          className="mx-4 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs lg:mx-0"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="hidden truncate text-xs text-ink-2 lg:block">{workspaces[0]?.name}</div>
      )}
      <ul className="flex gap-1 overflow-x-auto px-4 pb-2 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ITEMS.map((i) => {
          const href = base + i.href;
          const active = i.href === "" ? pathname === base : pathname.startsWith(href);
          const Icon = i.icon;
          return (
            <li key={i.href}>
              <Link
                href={href + (["/setup", "/settings", "/alerts"].includes(i.href) ? "" : keep)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                <Icon size={15} /> {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto hidden border-t border-line pt-3 text-xs text-muted lg:block">
        <div className="truncate">{email}</div>
        <button
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/";
          }}
          className="mt-2 inline-flex items-center gap-1 text-ink-2 hover:text-ink"
        >
          <LogOut size={12} /> Sign out
        </button>
        <div className="mt-1">
          <Link href="/onboarding" className="text-ink-2 hover:text-ink">
            + New workspace
          </Link>
        </div>
      </div>
    </nav>
  );
}
