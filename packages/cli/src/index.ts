import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { computeValueUsd, detectPlan, modelLabel, PLANS, type UsageRecord } from "@claude-obs/shared";
import { readAccount } from "./account";
import { agentInstalled, agentPlan, installAgent, isEphemeralInstall, uninstallAgent } from "./agent";
import { api, DEFAULT_SERVER } from "./api";
import { consoleLogger, fileLogger } from "./log";
import { acquireLock, lockHolder } from "./lock";
import { installOtel, otelEnv, uninstallOtel } from "./otel";
import { CLI_VERSION, defaultClaudeRoot, expandHome, files, obsHome } from "./paths";
import {
  deleteCredentials,
  emptyState,
  loadConfig,
  loadCredentials,
  loadState,
  readJson,
  saveConfig,
  saveCredentials,
  saveState,
  type Credentials,
} from "./store";
import { collect, defaultDeviceName, flushOutbox, pendingCount, syncOnce, type CollectResult } from "./sync";
import { watch } from "./watch";

const HELP = `claude-obs ${CLI_VERSION}: upload usage-only records from Claude Code to Claude Observability

Usage:
  claude-obs login [--code XXXX-XXXX] [--name "Studio Mac"] [--server URL]
  claude-obs sync [--watch] [--dry-run [--all] [--json]] [--verbose]
  claude-obs status
  claude-obs install-agent [--print] | uninstall-agent
  claude-obs config-dirs [list | add <path> | remove <path>]
  claude-obs config [titles on|off] [hash-projects on|off]
  claude-obs otel --print | --install [--force] | --uninstall
  claude-obs show-last-upload
  claude-obs resync
  claude-obs doctor
  claude-obs logout

Nothing but token counts, model names, timestamps, ids, project basenames,
git branch and (optionally) session titles ever leaves this machine.
Run \`claude-obs sync --dry-run\` to see exactly what would be sent.
`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    code: { type: "string" },
    name: { type: "string" },
    server: { type: "string" },
    watch: { type: "boolean" },
    "dry-run": { type: "boolean" },
    all: { type: "boolean" },
    json: { type: "boolean" },
    print: { type: "boolean" },
    install: { type: "boolean" },
    uninstall: { type: "boolean" },
    force: { type: "boolean" },
    agent: { type: "boolean" },
    verbose: { type: "boolean", short: "v" },
    quiet: { type: "boolean", short: "q" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean" },
  },
});

const log = flags.agent ? fileLogger(flags.verbose) : consoleLogger({ verbose: flags.verbose, quiet: flags.quiet });

function requireCreds(): Credentials {
  const c = loadCredentials();
  if (!c) {
    console.error("Not logged in. Run `claude-obs login --code <code>` (get a code from the dashboard → Settings → Machines).");
    process.exit(2);
  }
  return c;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function table(rows: (string | number)[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows
    .map((r) => r.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]!) : String(c).padStart(widths[i]!))).join("  "))
    .join("\n");
}

function report(c: CollectResult): void {
  for (const rr of c.roots) {
    console.log(`\n${rr.root}`);
    if (rr.status === "missing") {
      console.log("  (no projects folder; nothing to read)");
      continue;
    }
    if (rr.status === "no_account") {
      console.log("  skipped: no Claude login found in .claude.json (run `claude` and log in first)");
      continue;
    }
    const usage = rr.records.filter((r): r is UsageRecord => r.kind === "usage");
    const by = new Map<string, { n: number; in: number; out: number; cr: number; cw: number; v: number }>();
    let unknownValue = 0;
    for (const u of usage) {
      const k = modelLabel(u.model);
      const e = by.get(k) ?? { n: 0, in: 0, out: 0, cr: 0, cw: 0, v: 0 };
      const v = computeValueUsd(u.model, u);
      if (v === null) unknownValue++;
      e.n++;
      e.in += u.input;
      e.out += u.output;
      e.cr += u.cacheRead;
      e.cw += u.cacheWrite5m + u.cacheWrite1h;
      e.v += v ?? 0;
      by.set(k, e);
    }
    const rows: (string | number)[][] = [["model", "requests", "input", "output", "cache read", "cache write", "API-equiv."]];
    const tot = { n: 0, in: 0, out: 0, cr: 0, cw: 0, v: 0 };
    for (const [k, e] of [...by.entries()].sort((a, b) => b[1].v - a[1].v)) {
      rows.push([k, fmt(e.n), fmt(e.in), fmt(e.out), fmt(e.cr), fmt(e.cw), usd(e.v)]);
      for (const key of Object.keys(tot) as (keyof typeof tot)[]) tot[key] += e[key];
    }
    rows.push(["total", fmt(tot.n), fmt(tot.in), fmt(tot.out), fmt(tot.cr), fmt(tot.cw), usd(tot.v)]);
    console.log(
      `  ${fmt(rr.files)} files, ${fmt(rr.acc.linesRead)} lines read; ${fmt(rr.acc.usage.size)} unique requests ` +
        `(${fmt(rr.acc.duplicateLines)} repeated lines collapsed), ${fmt(rr.alreadySent)} already uploaded`,
    );
    const sessions = new Set(usage.map((u) => u.sessionId)).size;
    const sub = usage.filter((u) => u.isSubagent).length;
    console.log(`  ${fmt(sessions)} sessions, ${fmt(sub)} subagent requests, ${rr.acc.errors.size} errors, ${rr.acc.limits.size} limit hits`);
    if (usage.length) console.log(`\n${table(rows).replace(/^/gm, "  ")}`);
    if (unknownValue) console.log(`  note: ${unknownValue} requests use models missing from the price book`);
    const unk = Object.entries(rr.acc.unknownTypes);
    if (unk.length) console.log(`  unrecognized record types (ignored): ${unk.map(([k, v]) => `${k}×${v}`).join(", ")}`);
    if (rr.acc.malformedLines) console.log(`  malformed lines skipped: ${rr.acc.malformedLines}`);
  }
}

async function main(): Promise<void> {
  if (flags.version) return void console.log(CLI_VERSION);
  const cmd = positionals[0] ?? (flags.help ? "help" : "help");

  switch (cmd) {
    case "help":
      return void console.log(HELP);

    case "login": {
      const server = (flags.server ?? DEFAULT_SERVER).replace(/\/+$/, "");
      const name = flags.name ?? defaultDeviceName();
      const os = `${process.platform}-${process.arch}`;
      let res;
      if (flags.code) {
        res = await api.enroll(server, { code: flags.code.trim().toUpperCase(), name, os, configDir: process.env.CLAUDE_CONFIG_DIR ?? null });
      } else {
        const start = await api.deviceStart(server, { name, os });
        console.log(`\nOpen ${start.verificationUrl}\nand confirm the code:  ${start.userCode}\n\nWaiting for approval…`);
        const deadline = Date.now() + start.expiresIn * 1000;
        for (;;) {
          await new Promise((r) => setTimeout(r, start.interval * 1000));
          const p = await api.devicePoll(server, start.deviceCode);
          if (p.status === "approved") {
            res = p;
            break;
          }
          if (p.status === "denied") throw new Error("The request was denied in the browser.");
          if (p.status === "expired" || Date.now() > deadline) throw new Error("The code expired. Run `claude-obs login` again.");
        }
      }
      saveCredentials({
        server,
        deviceId: res.deviceId,
        deviceName: name,
        token: res.token,
        workspaceId: res.workspaceId,
        workspaceName: res.workspaceName,
        hashSalt: res.hashSalt,
      });
      const acct = readAccount(defaultClaudeRoot());
      const plan = detectPlan(acct.rateLimitTier);
      console.log(`\n✓ This machine ("${name}") is linked to workspace "${res.workspaceName}".`);
      if (plan) console.log(`  Detected plan: ${PLANS[plan].label}`);
      if (!acct.accountUuid) console.log("  warning: no Claude login found yet; run `claude` and log in, then sync.");
      console.log("\nNext: `claude-obs sync` to upload history, then `claude-obs install-agent` to keep it live.");
      return;
    }

    case "sync": {
      const config = loadConfig();
      if (flags["dry-run"]) {
        const creds = loadCredentials();
        const state = flags.all ? emptyState() : loadState();
        const c = collect(config, state, creds?.hashSalt ?? "dry-run", { all: flags.all });
        if (flags.json) return void console.log(JSON.stringify(c.batches, null, 2));
        console.log(`Dry run: nothing is uploaded${flags.all ? " (whole history, ignoring local progress)" : ""}.`);
        report(c);
        const sample = c.batches.flatMap((b) => b.records).find((r) => r.kind === "usage");
        if (sample) console.log(`\nExample record exactly as it would be sent:\n${JSON.stringify(sample, null, 2)}`);
        return;
      }
      const creds = requireCreds();
      const lock = acquireLock();
      if (!lock.ok) {
        console.log(`The background agent (pid ${lock.holder}) is already syncing; nothing to do.`);
        return;
      }
      if (flags.watch) {
        log.info(`claude-obs ${CLI_VERSION} watching for new Claude Code activity…`);
        await watch(log);
        return;
      }
      const { collected, flush } = await syncOnce(config, creds, log, { all: flags.all });
      if (!flags.quiet) report(collected);
      const queued = collected.batches.reduce((n, b) => n + b.records.length, 0);
      console.log(
        `\nQueued ${fmt(queued)} records in ${collected.batches.length} batches; uploaded ${fmt(flush?.uploaded ?? 0)}` +
          (flush?.deduplicated ? ` (${fmt(flush.deduplicated)} already on the server)` : "") +
          (flush?.pending ? `; ${flush.pending} batches waiting to retry (${flush.lastError})` : "."),
      );
      if (flush?.fatal === "unauthorized") console.error("This device's token was rejected. Run `claude-obs login` again.");
      if (flush?.fatal === "upgrade_required") console.error("The server needs a newer claude-obs: npm i -g claude-obs@latest");
      lock.release();
      return;
    }

    case "status": {
      const creds = loadCredentials();
      const state = loadState();
      const config = loadConfig();
      console.log(`claude-obs ${CLI_VERSION}  (data in ${obsHome()})`);
      if (!creds) console.log("Not logged in.");
      else {
        console.log(`Workspace: ${creds.workspaceName}  ·  device "${creds.deviceName}"  ·  server ${creds.server}`);
        try {
          const who = await api.whoami(creds.server, creds.token);
          console.log(`Server check: ok (device ${who.deviceName})`);
        } catch (e) {
          console.log(`Server check: FAILED (${(e as Error).message})`);
        }
      }
      for (const root of config.configDirs) {
        const a = readAccount(root);
        const plan = detectPlan(a.rateLimitTier);
        console.log(`Claude folder: ${root}  ·  ${a.accountUuid ? `logged in${plan ? ` (${PLANS[plan].label})` : ""}` : "no Claude login found"}`);
      }
      console.log(`Tracked files: ${Object.keys(state.files).length}  ·  pending batches: ${pendingCount()}`);
      console.log(`Last sync: ${state.lastSyncAt ?? "never"}  ·  last upload: ${state.lastUploadAt ?? "never"}`);
      if (state.lastError) console.log(`Last error: ${state.lastError}`);
      const holder = lockHolder();
      console.log(`Background agent: ${agentInstalled() ? "installed" : "not installed"}${holder ? `, running (pid ${holder})` : ""}`);
      const unk = Object.entries(state.unknownTypes);
      if (unk.length) console.log(`Unrecognized record types seen: ${unk.map(([k, v]) => `${k}×${v}`).join(", ")}`);
      return;
    }

    case "install-agent": {
      if (flags.print) {
        const p = agentPlan();
        console.log(`# ${p.kind}${p.file ? ` → ${p.file}` : ""}\n${p.contents}\n# activate: ${p.activate.map((c) => c.join(" ")).join(" && ")}`);
        return;
      }
      requireCreds();
      if (isEphemeralInstall()) {
        console.error("claude-obs is running from a temporary npx folder. Install it first:  npm i -g claude-obs  then run  claude-obs install-agent");
        process.exit(1);
      }
      const p = installAgent();
      console.log(`✓ Background agent installed (${p.kind}${p.file ? `: ${p.file}` : ""}). Logs: ${path.join(files.logDir(), "agent.log")}`);
      return;
    }

    case "uninstall-agent": {
      const p = uninstallAgent();
      console.log(`✓ Background agent removed (${p.kind}).`);
      return;
    }

    case "config-dirs": {
      const config = loadConfig();
      const sub = positionals[1] ?? "list";
      const target = positionals[2] ? path.resolve(expandHome(positionals[2])) : null;
      if (sub === "add" && target) {
        if (!fs.existsSync(path.join(target, "projects"))) console.warn(`warning: ${target}/projects does not exist (yet).`);
        if (!config.configDirs.includes(target)) config.configDirs.push(target);
        saveConfig(config);
      } else if (sub === "remove" && target) {
        config.configDirs = config.configDirs.filter((d) => d !== target);
        saveConfig(config);
      } else if (sub !== "list") {
        console.error("usage: claude-obs config-dirs [list | add <path> | remove <path>]");
        process.exit(1);
      }
      for (const d of loadConfig().configDirs) console.log(d);
      return;
    }

    case "config": {
      const config = loadConfig();
      const [, key, val] = positionals;
      if (key) {
        const on = val === "on" || val === "true";
        if (key === "titles") config.titles = on;
        else if (key === "hash-projects") config.hashProjects = on;
        else {
          console.error("keys: titles, hash-projects");
          process.exit(1);
        }
        saveConfig(config);
      }
      const c = loadConfig();
      console.log(`titles: ${c.titles ? "on" : "off"}\nhash-projects: ${c.hashProjects ? "on" : "off"}\nconfig-dirs: ${c.configDirs.join(", ")}`);
      return;
    }

    case "otel": {
      if (flags.uninstall) {
        console.log(`✓ Removed claude-obs telemetry settings from ${uninstallOtel()}. Restart Claude Code to apply.`);
        return;
      }
      const creds = requireCreds();
      if (flags.install) {
        const r = installOtel(creds, { force: flags.force });
        console.log(`✓ Telemetry enabled in ${r.file}${r.backup ? ` (backup: ${r.backup})` : ""}.\n  Restart Claude Code (CLI sessions and the desktop app) to start sending live events.`);
        return;
      }
      console.log(`Add this to ~/.claude/settings.json (or run \`claude-obs otel --install\`):\n`);
      console.log(JSON.stringify({ env: otelEnv(creds) }, null, 2));
      return;
    }

    case "show-last-upload": {
      const last = readJson(files.lastUpload());
      console.log(last ? JSON.stringify(last, null, 2) : "Nothing uploaded yet.");
      return;
    }

    case "resync": {
      const s = loadState();
      s.files = {};
      s.sent = {};
      saveState(s);
      console.log("Local progress cleared. The next sync re-reads all history; the server ignores duplicates.");
      return;
    }

    case "logout": {
      const creds = loadCredentials();
      if (agentInstalled()) uninstallAgent();
      if (creds) await api.revoke(creds.server, creds.token);
      deleteCredentials();
      fs.rmSync(files.state(), { force: true });
      fs.rmSync(files.outbox(), { recursive: true, force: true });
      console.log("✓ Logged out; device token revoked and local state removed.");
      return;
    }

    case "doctor": {
      const ok = (b: boolean) => (b ? "ok " : "FAIL");
      const major = Number(process.versions.node.split(".")[0]);
      console.log(`${ok(major >= 20)} node ${process.version} (need ≥ 20)`);
      const creds = loadCredentials();
      console.log(`${ok(!!creds)} credentials ${creds ? `(${creds.server})` : "missing: run claude-obs login"}`);
      if (creds) {
        try {
          const t0 = Date.now();
          const res = await fetch(new URL("/api/health", creds.server), { signal: AbortSignal.timeout(10_000) });
          const date = Date.parse(res.headers.get("date") ?? "");
          const skew = Number.isFinite(date) ? Math.round((Date.now() - date) / 1000) : null;
          console.log(`${ok(res.ok)} server reachable in ${Date.now() - t0} ms${skew !== null && Math.abs(skew) > 120 ? `; clock skew ${skew}s` : ""}`);
        } catch (e) {
          console.log(`FAIL server unreachable: ${(e as Error).message}`);
        }
      }
      for (const root of loadConfig().configDirs) {
        const exists = fs.existsSync(path.join(root, "projects"));
        console.log(`${ok(exists)} ${root}/projects ${exists ? "" : "missing"}`);
        console.log(`${ok(!!readAccount(root).accountUuid)} Claude login in ${root}`);
        try {
          fs.watch(path.join(root, "projects"), { recursive: true }).close();
          console.log("ok  recursive file watching supported");
        } catch {
          console.log("WARN recursive file watching unavailable; the agent will poll every 5 s");
        }
      }
      if (creds && pendingCount()) {
        const r = await flushOutbox(creds, log);
        console.log(`${ok(r.pending === 0)} outbox flush: uploaded ${r.uploaded}, pending ${r.pending}${r.lastError ? ` (${r.lastError})` : ""}`);
      }
      return;
    }

    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e: Error) => {
  log.error(e.message);
  if (!flags.agent) console.error(`error: ${e.message}`);
  process.exit(1);
});
