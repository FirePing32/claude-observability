import fs from "node:fs";
import path from "node:path";
import { defaultClaudeRoot } from "./paths";
import type { Credentials } from "./store";

export function otelEnv(creds: Credentials): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: `${creds.server.replace(/\/+$/, "")}/api/otlp`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${creds.token}`,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
  };
}

const settingsFile = (root = defaultClaudeRoot()) => path.join(root, "settings.json");

type Settings = { env?: Record<string, string>; [k: string]: unknown };

function readSettings(file: string): Settings {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Settings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${file} is not valid JSON; fix it before installing telemetry.`);
  }
}

/** Merge our OTel env into Claude Code's settings.json (CLI + desktop app both read it). Backs up first. */
export function installOtel(creds: Credentials, opts: { force?: boolean; root?: string } = {}): { file: string; backup: string | null } {
  const file = settingsFile(opts.root);
  const s = readSettings(file);
  const env = { ...(s.env ?? {}) };
  const ours = otelEnv(creds);
  const existing = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (existing && existing !== ours.OTEL_EXPORTER_OTLP_ENDPOINT && !opts.force) {
    throw new Error(`settings.json already sends telemetry to ${existing}. Re-run with --force to replace it.`);
  }
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
  }
  s.env = { ...env, ...ours };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  return { file, backup };
}

export function uninstallOtel(opts: { root?: string } = {}): string {
  const file = settingsFile(opts.root);
  const s = readSettings(file);
  if (!s.env) return file;
  for (const k of Object.keys(otelEnv({ server: "x", token: "x" } as Credentials))) delete s.env[k];
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  return file;
}
