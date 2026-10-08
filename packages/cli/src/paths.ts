import os from "node:os";
import path from "node:path";

declare const __CLI_VERSION__: string;
export const CLI_VERSION: string = typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";
export const PARSER_VERSION = "1.0.0";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Where claude-obs keeps credentials, config, state and the outbox. */
export function obsHome(): string {
  if (process.env.CLAUDE_OBS_HOME) return path.resolve(expandHome(process.env.CLAUDE_OBS_HOME));
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "claude-obs");
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "claude-obs");
}

export const files = {
  credentials: () => path.join(obsHome(), "credentials.json"),
  config: () => path.join(obsHome(), "config.json"),
  state: () => path.join(obsHome(), "state.json"),
  outbox: () => path.join(obsHome(), "outbox"),
  quarantine: () => path.join(obsHome(), "quarantine"),
  lastUpload: () => path.join(obsHome(), "last-upload.json"),
  lock: () => path.join(obsHome(), "agent.lock"),
  logDir: () => path.join(obsHome(), "logs"),
};

/** The Claude Code config folder this process would use. */
export function defaultClaudeRoot(): string {
  return path.resolve(expandHome(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")));
}

/**
 * `~/.claude.json` sits next to the default `~/.claude` folder; with a custom
 * CLAUDE_CONFIG_DIR, Claude Code keeps `.claude.json` inside that folder.
 */
export function claudeJsonCandidates(root: string): string[] {
  const home = os.homedir();
  const isDefault = path.resolve(root) === path.resolve(home, ".claude");
  return isDefault
    ? [path.join(home, ".claude.json"), path.join(root, ".claude.json")]
    : [path.join(root, ".claude.json")];
}
