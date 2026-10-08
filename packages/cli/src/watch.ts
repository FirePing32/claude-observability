import fs from "node:fs";
import path from "node:path";
import type { Logger } from "./log";
import { loadConfig, loadCredentials } from "./store";
import { syncOnce } from "./sync";

const DEBOUNCE_MS = 1500;
const POLL_MS = 5000;
const RESCAN_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Long-running watcher: re-syncs shortly after any transcript changes, with a
 * polling fallback and a periodic full rescan as a safety net. Passes are
 * serialized; upload failures back off exponentially up to 5 minutes.
 */
export async function watch(log: Logger, opts: { onPass?: (summary: string) => void } = {}): Promise<never> {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let again = false;
  let backoff = 0;
  let retryTimer: NodeJS.Timeout | null = null;

  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
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
        schedule();
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pass(), DEBOUNCE_MS);
  };

  const roots = loadConfig().configDirs;
  let watching = 0;
  for (const root of roots) {
    const dir = path.join(root, "projects");
    try {
      fs.watch(dir, { recursive: true, persistent: true }, (_event, name) => {
        if (!name || String(name).endsWith(".jsonl")) schedule();
      });
      watching++;
      log.info(`watching ${dir}`);
    } catch (e) {
      log.warn(`fs.watch unavailable for ${dir} (${(e as Error).message}); polling every ${POLL_MS / 1000}s`);
    }
  }
  if (watching < roots.length) setInterval(() => void pass(), POLL_MS);
  setInterval(() => void pass(), RESCAN_MS);

  await pass();
  return new Promise<never>(() => undefined);
}
