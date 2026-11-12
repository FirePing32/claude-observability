import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_RECORDS_PER_BATCH, SCHEMA_VERSION, type IngestBatch, type IngestRecord } from "@claude-obs/shared";
import { hashAccount, makeProjectNamer, readAccount } from "./account";
import { uploadBatch } from "./api";
import { discoverTranscripts } from "./discover";
import type { Logger } from "./log";
import { Accumulator, parseLine } from "./parse";
import { PARSER_VERSION, files } from "./paths";
import { readNewLines } from "./reader";
import {
  loadConfig,
  loadState,
  readJson,
  saveState,
  writeJsonAtomic,
  type Config,
  type Credentials,
  type FileState,
  type SavedAccount,
  type State,
} from "./store";

export interface RootResult {
  root: string;
  /** account_switched: the Claude login changed since the last pass, so this pass's lines were read but not sent. */
  status: "ok" | "no_account" | "missing" | "account_switched";
  files: number;
  bytes: number;
  acc: Accumulator;
  records: IngestRecord[];
  alreadySent: number;
  /** Records not sent because they may belong to the other account (see status account_switched). */
  skippedForSwitch: number;
}

export interface CollectResult {
  roots: RootResult[];
  batches: IngestBatch[];
  fileUpdates: Record<string, FileState>;
  sentUpdates: Record<string, [number, number]>;
  /** The account now logged in for each root (null when logged out), to remember for the next pass. */
  accountUpdates: Record<string, SavedAccount | null>;
}

export interface CollectOptions {
  /** Ignore local progress and re-read everything (resync, dry-run --all). */
  all?: boolean;
  /**
   * The Claude login has just changed: label what's been written since the last pass with the account that was
   * logged in then, not the new one. Set by the watcher when it sees the login file change.
   */
  previousAccount?: boolean;
}

const toSaved = (salt: string, a: ReturnType<typeof readAccount>): SavedAccount | null =>
  a.accountUuid
    ? { hash: hashAccount(salt, a.accountUuid), emailProof: a.emailProof, rateLimitTier: a.rateLimitTier, seatTier: a.seatTier, billingType: a.billingType }
    : null;

/** The salted hash of the account each root is logged into now (null when logged out). */
export function currentAccountHashes(config: Config, salt: string): Map<string, string | null> {
  return new Map(config.configDirs.map((root) => [root, toSaved(salt, readAccount(root))?.hash ?? null]));
}

/**
 * Parse everything new under each configured Claude root into upload batches (no I/O side effects).
 *
 * Session files don't record which Claude account wrote them, so lines are labelled with the account logged in
 * when they're read. To keep another account's usage out after a login switch, the account seen at each pass is
 * remembered: if it differs now and the watcher didn't catch the switch as it happened, the lines written in
 * between could belong to either account, so they're read past but not sent.
 */
export function collect(config: Config, state: State, salt: string, opts: CollectOptions = {}): CollectResult {
  const result: CollectResult = { roots: [], batches: [], fileUpdates: {}, sentUpdates: {}, accountUpdates: {} };
  const projectOf = makeProjectNamer(salt, config.hashProjects);

  for (const root of config.configDirs) {
    const acc = new Accumulator();
    const rr: RootResult = { root, status: "ok", files: 0, bytes: 0, acc, records: [], alreadySent: 0, skippedForSwitch: 0 };
    result.roots.push(rr);
    if (!fs.existsSync(path.join(root, "projects"))) {
      rr.status = "missing";
      continue;
    }
    const current = toSaved(salt, readAccount(root));
    const saved = opts.all ? undefined : state.accounts?.[root];
    let label: SavedAccount;
    let ambiguous = false;
    if (opts.previousAccount && saved) {
      label = saved; // the login just changed; everything up to now was written under the old account
    } else if (!current) {
      rr.status = "no_account";
      continue;
    } else {
      label = current;
      ambiguous = Boolean(saved && saved.hash !== current.hash);
    }
    result.accountUpdates[root] = current;

    for (const f of discoverTranscripts(root)) {
      const prev = opts.all ? undefined : state.files[f.path];
      const ctx = { isSubagent: f.isSubagent, agentId: f.agentId, agentType: f.agentType, titles: config.titles, projectOf };
      const r = readNewLines(f.path, prev, (line) => parseLine(line, ctx, acc));
      if (!r) continue;
      rr.files++;
      rr.bytes += r.bytes;
      // save whenever anything differs (including the device id), so a stale entry can't keep forcing re-reads
      if (!prev || r.state.offset !== prev.offset || r.state.ino !== prev.ino || r.state.dev !== prev.dev) result.fileUpdates[f.path] = r.state;
    }

    if (ambiguous) {
      rr.status = "account_switched";
      rr.skippedForSwitch = acc.usage.size + acc.meta.size + acc.snapshots.size + acc.events.size + acc.errors.size + acc.limits.size;
      continue;
    }

    // Requests: skip ones already sent with the same or larger output (streaming may grow it).
    for (const u of acc.usage.values()) {
      const sent = opts.all ? undefined : state.sent[u.requestId];
      if (sent && sent[0] >= u.output) {
        rr.alreadySent++;
        continue;
      }
      rr.records.push(u);
      result.sentUpdates[u.requestId] = [u.output, Math.floor(Date.parse(u.ts) / 1000)];
    }
    rr.records.push(
      ...acc.meta.values(),
      ...acc.snapshots.values(),
      ...acc.events.values(),
      ...acc.errors.values(),
      ...acc.limits.values(),
    );

    const header: Omit<IngestBatch, "records"> = {
      schemaVersion: SCHEMA_VERSION,
      accountHash: label.hash,
      accountEmailProof: label.emailProof,
      plan: { rateLimitTier: label.rateLimitTier, seatTier: label.seatTier, billingType: label.billingType },
      device: { os: `${process.platform}-${process.arch}`, ccVersions: [...acc.ccVersions].slice(0, 50) },
      parser: { version: PARSER_VERSION, unknownTypes: acc.unknownTypes, malformedLines: acc.malformedLines },
    };
    for (let i = 0; i < rr.records.length; i += MAX_RECORDS_PER_BATCH) {
      result.batches.push({ ...header, records: rr.records.slice(i, i + MAX_RECORDS_PER_BATCH) });
    }
  }
  return result;
}

// ---------- outbox ----------

function outboxFiles(): string[] {
  try {
    return fs
      .readdirSync(files.outbox())
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(files.outbox(), f));
  } catch {
    return [];
  }
}

export function pendingCount(): number {
  return outboxFiles().length;
}

let seq = 0;
function enqueue(batch: IngestBatch): void {
  const name = `${Date.now().toString().padStart(14, "0")}-${String(seq++).padStart(6, "0")}-${crypto.randomBytes(3).toString("hex")}.json`;
  writeJsonAtomic(path.join(files.outbox(), name), batch);
}

function quarantine(file: string, reason: string): void {
  fs.mkdirSync(files.quarantine(), { recursive: true, mode: 0o700 });
  fs.renameSync(file, path.join(files.quarantine(), path.basename(file)));
  fs.writeFileSync(path.join(files.quarantine(), `${path.basename(file)}.reason.txt`), reason);
}

export interface FlushResult {
  uploaded: number;
  batches: number;
  deduplicated: number;
  pending: number;
  fatal: "unauthorized" | "upgrade_required" | null;
  retryAfterSec: number | null;
  lastError: string | null;
}

/**
 * Batches queued by an older collector may lack fields the server now requires (the e-mail proof, added
 * in 0.1.4). Fill them from this machine's current Claude login, but only for batches that belong to that
 * same Claude account (matched by the salted account hash).
 */
export function currentEmailProofs(salt: string, config: Config = loadConfig()): Map<string, string> {
  const m = new Map<string, string>();
  for (const root of config.configDirs) {
    const a = readAccount(root);
    if (a.accountUuid && a.emailProof) m.set(hashAccount(salt, a.accountUuid), a.emailProof);
  }
  return m;
}

export function upgradeQueuedBatch(batch: IngestBatch, proofs: Map<string, string>): IngestBatch {
  if (batch.accountEmailProof) return batch;
  const proof = proofs.get(batch.accountHash);
  return proof ? { ...batch, accountEmailProof: proof } : batch;
}

export async function flushOutbox(creds: Credentials, log: Logger): Promise<FlushResult> {
  const out: FlushResult = { uploaded: 0, batches: 0, deduplicated: 0, pending: 0, fatal: null, retryAfterSec: null, lastError: null };
  let proofs: Map<string, string> | null = null;
  for (const file of outboxFiles()) {
    const stored = readJson<IngestBatch>(file);
    if (!stored) {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (!stored.accountEmailProof) proofs ??= currentEmailProofs(creds.hashSalt);
    const batch = proofs ? upgradeQueuedBatch(stored, proofs) : stored;
    const r = await uploadBatch(creds.server, creds.token, batch);
    if (r.ok) {
      out.batches++;
      out.uploaded += r.res.accepted;
      out.deduplicated += r.res.deduplicated;
      writeJsonAtomic(files.lastUpload(), { uploadedAt: new Date().toISOString(), response: r.res, batch });
      fs.rmSync(file, { force: true });
      continue;
    }
    out.lastError = `${r.error}: ${r.message}`;
    if (r.error === "unauthorized" || r.status === 401) {
      out.fatal = "unauthorized";
      break;
    }
    if (r.error === "upgrade_required" || r.status === 426) {
      out.fatal = "upgrade_required";
      break;
    }
    if (r.retryable) {
      out.retryAfterSec = r.retryAfterSec ?? null;
      log.debug(`upload deferred (${out.lastError}); will retry`);
      break; // keep order; retry later
    }
    log.warn(
      r.error === "email_mismatch"
        ? `upload refused: this machine's Claude login e-mail isn't approved for the workspace (${r.message}); batch moved to quarantine`
        : `batch rejected (${out.lastError}); moved to quarantine`,
    );
    quarantine(file, out.lastError);
  }
  out.pending = outboxFiles().length;
  return out;
}

// ---------- one sync pass ----------

export interface SyncResult {
  collected: CollectResult;
  flush: FlushResult | null;
}

/**
 * Collect → enqueue (durable) → commit offsets → upload. Offsets are committed
 * as soon as batches are safely in the outbox; a crash in between only causes
 * a re-send, which the server deduplicates. Nothing is ever lost.
 */
export async function syncOnce(config: Config, creds: Credentials, log: Logger, opts: CollectOptions = {}): Promise<SyncResult> {
  const state = loadState();
  const collected = collect(config, state, creds.hashSalt, opts);
  for (const b of collected.batches) enqueue(b);

  Object.assign(state.files, collected.fileUpdates);
  Object.assign(state.sent, collected.sentUpdates);
  for (const [root, a] of Object.entries(collected.accountUpdates)) {
    if (a) state.accounts[root] = a;
    else delete state.accounts[root];
  }
  for (const rr of collected.roots) {
    if (rr.status !== "account_switched") continue;
    state.lastSwitchSkip = { at: new Date().toISOString(), root: rr.root, records: rr.skippedForSwitch };
    log.warn(
      `Claude login in ${rr.root} changed since the last upload; skipped ${rr.skippedForSwitch} records written around the switch so another account's usage isn't counted`,
    );
  }
  for (const rr of collected.roots) {
    for (const [k, v] of Object.entries(rr.acc.unknownTypes)) state.unknownTypes[k] = (state.unknownTypes[k] ?? 0) + v;
    state.malformedLines += rr.acc.malformedLines;
  }
  state.lastSyncAt = new Date().toISOString();
  saveState(state);

  const flush = await flushOutbox(creds, log);
  const s2 = loadState();
  if (flush.batches > 0) s2.lastUploadAt = new Date().toISOString();
  s2.lastError = flush.lastError;
  saveState(s2);
  return { collected, flush };
}

export function defaultDeviceName(): string {
  return os.hostname().replace(/\.local$/, "").slice(0, 100) || "machine";
}
