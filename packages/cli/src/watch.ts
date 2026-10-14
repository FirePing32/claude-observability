import fs from "node:fs";
import path from "node:path";
import type { Logger } from "./log";
import { files, obsHome } from "./paths";
import { loadConfig, loadCredentials } from "./store";
import { syncOnce } from "./sync";

const TICK_MS = 60 * 1000;
const RESCAN_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** True (and clears the request) when `claude-obs sync` asked the running agent to upload now. */
function takeSyncNow(): boolean {
  try {
    fs.rmSync(files.syncNow());
    return true;
  } catch {
    return false;
  }
}

/** Ask a running agent to upload on its next check (within a minute, or at once where file watching works). */
export function requestSyncNow(): void {
  fs.mkdirSync(obsHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(files.syncNow(), new Date().toISOString());
}

/**
 * Long-running uploader. File changes only mark the collector dirty; a pass (read new lines →
 * outbox → upload) runs when it's dirty and the upload interval has elapsed since the last pass.
 * Batching uploads every few minutes, instead of seconds after each change, lets the dashboard's
 * database go idle between uploads. Nothing is lost by waiting: offsets only move forward once
 * a batch is in the outbox. A periodic rescan covers missed watch events; upload failures back
 * off exponentially up to 5 minutes.
 */
export async function watch(log: Logger, opts: { onPass?: (summary: string) => void; intervalMin?: number } = {}): Promise<never> {
  let running = false;
  let again = false;
  let dirty = true;
  let lastPassAt = 0;
  let lastRescanAt = Date.now();
  let backoff = 0;
  let retryTimer: NodeJS.Timeout | null = null;
  const intervalMs = () => (opts.intervalMin ?? loadConfig().uploadIntervalMin) * 60 * 1000;

  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    dirty = false; // changes that land during this pass mark it dirty again
    lastPassAt = Date.now();
    try {
      const creds = loadCredentials();
      if (!creds) {
        log.error("not logged in; run `claude-obs login`");
        process.exit(2);
      }
      const { collected, flush } = await syncOnce(loadConfig(), creds, log);
      const queued = collected.batches.reduce((n, b) => n + b.records.length, 0);
      if (queued || flush?.uploaded) {
        const msg = `queued ${queued} records, uploaded ${flush?.uploaded ?? 0}, pending batches ${flush?.pending ?? 0}`;
        log.info(msg);
        opts.onPass?.(msg);
      }
      if (flush?.fatal === "unauthorized") {
        log.error("device token rejected (revoked?). Run `claude-obs login` again.");
        process.exit(3);
      }
      if (flush?.fatal === "upgrade_required") {
        log.error("server requires a newer claude-obs. Upgrade with `npm i -g claude-obs@latest`.");
        process.exit(4);
      }
      if (flush && flush.pending > 0) {
        backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : 1000);
        const wait = flush.retryAfterSec ? Math.max(flush.retryAfterSec * 1000, backoff) : backoff;
        log.debug(`retrying upload in ${Math.round(wait / 1000)}s`);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void pass(), wait * (0.8 + Math.random() * 0.4));
      } else {
        backoff = 0;
      }
    } catch (e) {
      log.error(`sync pass failed: ${(e as Error).message}`);
    } finally {
      running = false;
      if (again) {
        again = false;
        void pass();
      }
    }
  };

  let polling = false;
  const tick = () => {
    const now = Date.now();
    if (takeSyncNow()) {
      log.info("upload requested by `claude-obs sync`");
      return void pass();
    }
    if (polling || now - lastRescanAt >= RESCAN_MS) {
      dirty = true;
      if (!polling) lastRescanAt = now;
    }
    if (dirty && now - lastPassAt >= intervalMs()) void pass();
  };

  const roots = loadConfig().configDirs;
  for (const root of roots) {
    const dir = path.join(root, "projects");
    try {
      fs.watch(dir, { recursive: true, persistent: true }, (_event, name) => {
        if (!name || String(name).endsWith(".jsonl")) dirty = true;
      });
      log.info(`watching ${dir}`);
    } catch (e) {
      polling = true;
      log.warn(`fs.watch unavailable for ${dir} (${(e as Error).message}); checking for new activity at each upload`);
    }
  }
  // React to `claude-obs sync` at once where watching works; the minute tick covers the rest.
  try {
    fs.mkdirSync(obsHome(), { recursive: true, mode: 0o700 });
    fs.watch(obsHome(), { persistent: true }, (_event, name) => {
      if (name === path.basename(files.syncNow())) tick();
    });
  } catch {
    /* tick polls for the request file */
  }
  setInterval(tick, TICK_MS);

  log.info(`uploading new activity every ${Math.round(intervalMs() / 60000)} min (run \`claude-obs sync\` to upload now)`);
  await pass();
  return new Promise<never>(() => undefined);
}
