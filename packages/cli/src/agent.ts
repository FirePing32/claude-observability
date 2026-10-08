import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { files } from "./paths";

const LABEL = "com.claude-obs.agent";

/**
 * Background services don't load your shell profile, so carry over the settings the
 * collector needs to reach the server: custom CA certificates (corporate TLS inspection),
 * proxies, and a non-default Claude config folder.
 */
const PASSTHROUGH_ENV = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_OBS_HOME",
  "CLAUDE_OBS_SERVER",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_SYSTEM_CA",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
];

export function agentEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PASSTHROUGH_ENV) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

export interface AgentPlan {
  kind: "launchd" | "systemd" | "schtasks";
  file: string | null;
  contents: string;
  activate: string[][];
  deactivate: string[][];
}

/** The command the service runs: this exact node binary + this exact script. */
function programArgs(): string[] {
  const script = fileURLToPath(import.meta.url);
  return [process.execPath, script, "sync", "--watch", "--agent"];
}

export function isEphemeralInstall(): boolean {
  const script = fileURLToPath(import.meta.url);
  return /[\\/]_npx[\\/]|[\\/]npm-cache[\\/]/.test(script);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function agentPlan(): AgentPlan {
  const args = programArgs();
  const env = agentEnv();
  if (process.platform === "darwin") {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    const log = path.join(files.logDir(), "launchd.log");
    const envXml = Object.entries(env)
      .map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`)
      .join("\n");
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
    const uid = String(process.getuid?.() ?? "");
    return {
      kind: "launchd",
      file,
      contents,
      activate: [["launchctl", "bootstrap", `gui/${uid}`, file]],
      deactivate: [["launchctl", "bootout", `gui/${uid}/${LABEL}`]],
    };
  }
  if (process.platform === "linux") {
    const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", "claude-obs.service");
    const quote = (a: string) => (/[\s"'\\]/.test(a) ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a);
    const contents = `[Unit]
Description=claude-obs collector (uploads Claude Code usage)
After=network-online.target

[Service]
ExecStart=${args.map(quote).join(" ")}
${Object.entries(env)
  .map(([k, v]) => `Environment=${k}=${quote(v)}`)
  .join("\n")}
Restart=on-failure
RestartSec=30
Nice=10

[Install]
WantedBy=default.target
`;
    return {
      kind: "systemd",
      file,
      contents,
      activate: [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "claude-obs.service"],
      ],
      deactivate: [["systemctl", "--user", "disable", "--now", "claude-obs.service"]],
    };
  }
  const tr = args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  return {
    kind: "schtasks",
    file: null,
    contents: tr,
    activate: [["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", "claude-obs", "/TR", tr]],
    deactivate: [["schtasks", "/Delete", "/F", "/TN", "claude-obs"]],
  };
}

function run(cmds: string[][], ignoreErrors: boolean): void {
  for (const [cmd, ...rest] of cmds) {
    try {
      execFileSync(cmd!, rest, { stdio: "pipe" });
    } catch (e) {
      if (!ignoreErrors) throw new Error(`${cmd} ${rest.join(" ")} failed: ${(e as Error).message}`);
    }
  }
}

export function installAgent(): AgentPlan {
  const plan = agentPlan();
  if (plan.file) {
    run(plan.deactivate, true); // replace an existing install cleanly
    fs.mkdirSync(path.dirname(plan.file), { recursive: true });
    fs.mkdirSync(files.logDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(plan.file, plan.contents, { mode: 0o644 });
  }
  run(plan.activate, false);
  return plan;
}

export function uninstallAgent(): AgentPlan {
  const plan = agentPlan();
  run(plan.deactivate, true);
  if (plan.file) fs.rmSync(plan.file, { force: true });
  return plan;
}

export function agentInstalled(): boolean {
  const plan = agentPlan();
  return plan.file ? fs.existsSync(plan.file) : false;
}
