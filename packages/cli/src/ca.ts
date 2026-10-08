import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { obsHome } from "./paths";

/**
 * Trust the operating system's certificate store, like a browser does, so the
 * collector works behind TLS-inspecting networks (Netskope, Zscaler, corporate
 * proxies) without any setup.
 *
 * - Node with `tls.setDefaultCACertificates` (22.19+, 24.5+): add the system
 *   certificates in-process.
 * - Older Node on macOS/Linux: point NODE_EXTRA_CA_CERTS at the system bundle
 *   and re-launch once (Node only reads that variable at startup).
 *
 * Opt out with CLAUDE_OBS_SYSTEM_CA=0.
 */

export type CaMode = "api" | "reexec-child" | "user-configured" | "disabled" | "unavailable";

const REEXEC_FLAG = "CLAUDE_OBS_CA_REEXEC";
const BUNDLE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

type TlsWithCa = typeof tls & {
  getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

/** Path to a PEM bundle of the OS-trusted certificates, or null if this platform has none we can read. */
export function systemBundle(): string | null {
  if (process.platform === "linux") {
    for (const f of ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/ca-bundle.pem", "/etc/ssl/cert.pem"]) {
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
  if (process.platform !== "darwin") return null;

  // macOS: export the System keychain (where MDM / security agents install their roots) plus Apple's roots, cached.
  const out = path.join(obsHome(), "system-ca.pem");
  try {
    const st = fs.statSync(out);
    if (Date.now() - st.mtimeMs < BUNDLE_MAX_AGE_MS && st.size > 0) return out;
  } catch {
    /* not cached yet */
  }
  try {
    const pem = execFileSync(
      "/usr/bin/security",
      ["find-certificate", "-a", "-p", "/Library/Keychains/System.keychain", "/System/Library/Keychains/SystemRootCertificates.keychain"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (!pem.includes("BEGIN CERTIFICATE")) return null;
    fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${out}.tmp`, pem, { mode: 0o644 });
    fs.renameSync(`${out}.tmp`, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Call first thing at startup. Returns "relaunched" when this process has handed
 * over to a child that has the system certificates; the caller must then do nothing else.
 */
export function useSystemCertificates(): { mode: CaMode } | "relaunched" {
  if (process.env.CLAUDE_OBS_SYSTEM_CA === "0") return { mode: "disabled" };
  if (process.env[REEXEC_FLAG] === "1") return { mode: "reexec-child" };

  const t = tls as TlsWithCa;
  if (typeof t.getCACertificates === "function" && typeof t.setDefaultCACertificates === "function") {
    try {
      const merged = [...new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")])];
      t.setDefaultCACertificates(merged);
      return { mode: "api" };
    } catch {
      /* fall through to the environment-based paths */
    }
  }

  // Respect explicit configuration (and Node versions that honour NODE_USE_SYSTEM_CA themselves).
  if (process.env.NODE_EXTRA_CA_CERTS) return { mode: "user-configured" };

  const bundle = systemBundle();
  if (!bundle) return { mode: "unavailable" };

  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_EXTRA_CA_CERTS: bundle, [REEXEC_FLAG]: "1" },
  });
  // Forward termination signals so the background agent stops cleanly.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", () => process.exit(1));
  return "relaunched";
}

export function describeCaMode(mode: CaMode): string {
  switch (mode) {
    case "api":
      return "system certificates loaded";
    case "reexec-child":
      return `system certificates loaded via NODE_EXTRA_CA_CERTS (${process.env.NODE_EXTRA_CA_CERTS ?? "?"})`;
    case "user-configured":
      return `using your NODE_EXTRA_CA_CERTS (${process.env.NODE_EXTRA_CA_CERTS})`;
    case "disabled":
      return "system certificates disabled (CLAUDE_OBS_SYSTEM_CA=0)";
    default:
      return "Node's built-in certificates only (no system bundle found on this OS)";
  }
}
