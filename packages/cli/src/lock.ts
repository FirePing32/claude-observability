import fs from "node:fs";
import path from "node:path";
import { files } from "./paths";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Returns the pid holding the lock, or null if none / stale. */
export function lockHolder(): number | null {
  try {
    const pid = Number(fs.readFileSync(files.lock(), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Single-instance lock so the background agent and a manual `sync` never race on state. */
export function acquireLock(): { ok: true; release: () => void } | { ok: false; holder: number } {
  fs.mkdirSync(path.dirname(files.lock()), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(files.lock(), String(process.pid), { flag: "wx", mode: 0o600 });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          if (fs.readFileSync(files.lock(), "utf8").trim() === String(process.pid)) fs.rmSync(files.lock());
        } catch {
          /* already gone */
        }
      };
      process.once("exit", release);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(sig, () => {
          release();
          process.exit(0);
        });
      }
      return { ok: true, release };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = lockHolder();
      if (holder) return { ok: false, holder };
      fs.rmSync(files.lock(), { force: true }); // stale lock from a crashed process
    }
  }
  return { ok: false, holder: -1 };
}
