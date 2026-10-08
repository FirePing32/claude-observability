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
import { loadConfig, loadState, readJson, saveState, writeJsonAtomic, type Config, type Credentials, type FileState, type State } from "./store";

export interface RootResult {
  root: string;
  status: "ok" | "no_account" | "missing";
  files: number;
  bytes: number;
  acc: Accumulator;
  records: IngestRecord[];
  alreadySent: number;
}

export interface CollectResult {
  roots: RootResult[];
  batches: IngestBatch[];
  fileUpdates: Record<string, FileState>;
  sentUpdates: Record<string, [number, number]>;
}

/** Parse everything new under each configured Claude root into upload batches (no I/O side effects). */
export function collect(config: Config, state: State, salt: string, opts: { all?: boolean } = {}): CollectResult {
  const result: CollectResult = { roots: [], batches: [], fileUpdates: {}, sentUpdates: {} };
  const projectOf = makeProjectNamer(salt, config.hashProjects);

  for (const root of config.configDirs) {
    const acc = new Accumulator();
    const rr: RootResult = { root, status: "ok", files: 0, bytes: 0, acc, records: [], alreadySent: 0 };
    result.roots.push(rr);
    if (!fs.existsSync(path.join(root, "projects"))) {
      rr.status = "missing";
      continue;
    }
    const account = readAccount(root);
    if (!account.accountUuid) {
      rr.status = "no_account";
      continue;
    }

    for (const f of discoverTranscripts(root)) {
      const prev = opts.all ? undefined : state.files[f.path];
      const ctx = { isSubagent: f.isSubagent, agentId: f.agentId, agentType: f.agentType, titles: config.titles, projectOf };
      const r = readNewLines(f.path, prev, (line) => parseLine(line, ctx, acc));
      if (!r) continue;
      rr.files++;
      rr.bytes += r.bytes;
      if (!prev || r.state.offset !== prev.offset || r.state.ino !== prev.ino) result.fileUpdates[f.path] = r.state;
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
      accountHash: hashAccount(salt, account.accountUuid),
      accountEmailProof: account.emailProof,
      plan: { rateLimitTier: account.rateLimitTier, seatTier: account.seatTier, billingType: account.billingType },
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
export async function syncOnce(config: Config, creds: Credentials, log: Logger, opts: { all?: boolean } = {}): Promise<SyncResult> {
  const state = loadState();
  const collected = collect(config, state, creds.hashSalt, opts);
  for (const b of collected.batches) enqueue(b);

  Object.assign(state.files, collected.fileUpdates);
  Object.assign(state.sent, collected.sentUpdates);
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
