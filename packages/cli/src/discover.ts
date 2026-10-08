import fs from "node:fs";
import path from "node:path";

export interface TranscriptFile {
  path: string;
  isSubagent: boolean;
  agentId: string | null;
  agentType: string | null;
}

function listDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readAgentType(jsonlPath: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(jsonlPath.replace(/\.jsonl$/, ".meta.json"), "utf8")) as {
      agentType?: unknown;
    };
    return typeof meta.agentType === "string" ? meta.agentType.slice(0, 100) : null;
  } catch {
    return null;
  }
}

/**
 * Finds `projects/<project>/<session>.jsonl` and
 * `projects/<project>/<session>/subagents/agent-<id>.jsonl` under a Claude config root.
 */
export function discoverTranscripts(root: string): TranscriptFile[] {
  const out: TranscriptFile[] = [];
  const projectsDir = path.join(root, "projects");
  for (const project of listDir(projectsDir)) {
    if (!project.isDirectory()) continue;
    const pdir = path.join(projectsDir, project.name);
    for (const entry of listDir(pdir)) {
      const full = path.join(pdir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push({ path: full, isSubagent: false, agentId: null, agentType: null });
      } else if (entry.isDirectory()) {
        for (const sub of listDir(path.join(full, "subagents"))) {
          if (!sub.isFile() || !sub.name.endsWith(".jsonl")) continue;
          const sp = path.join(full, "subagents", sub.name);
          const m = /^agent-(.+)\.jsonl$/.exec(sub.name);
          out.push({ path: sp, isSubagent: true, agentId: m?.[1] ?? null, agentType: readAgentType(sp) });
        }
      }
    }
  }
  return out;
}
