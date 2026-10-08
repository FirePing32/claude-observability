import fs from "node:fs";
import path from "node:path";
import { defaultClaudeRoot, expandHome, files } from "./paths";

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${file}: ${(e as Error).message}`);
  }
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
export function writeJsonAtomic(file: string, data: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// ---------- credentials ----------
export interface Credentials {
  server: string;
  deviceId: string;
  deviceName: string;
  token: string;
  workspaceId: string;
  workspaceName: string;
  hashSalt: string;
}

export function loadCredentials(): Credentials | null {
  return readJson<Credentials>(files.credentials());
}
export function saveCredentials(c: Credentials): void {
  writeJsonAtomic(files.credentials(), c, 0o600);
}
export function deleteCredentials(): void {
  fs.rmSync(files.credentials(), { force: true });
}

// ---------- config ----------
export interface Config {
  configDirs: string[];
  titles: boolean;
  hashProjects: boolean;
}

export function loadConfig(): Config {
  const c = readJson<Partial<Config>>(files.config()) ?? {};
  return {
    configDirs: c.configDirs?.length ? c.configDirs : [defaultClaudeRoot()],
    titles: c.titles ?? true,
    hashProjects: c.hashProjects ?? false,
  };
}
export function saveConfig(c: Config): void {
  writeJsonAtomic(files.config(), { ...c, configDirs: c.configDirs.map((d) => path.resolve(expandHome(d))) });
}

// ---------- state ----------
export interface FileState {
  dev: number;
  ino: number;
  /** Bytes consumed so far; always at a line boundary. */
  offset: number;
}

export interface State {
  version: 1;
  files: Record<string, FileState>;
  /** requestId -> [max output tokens sent, epoch seconds of request]. Pruned after a few days. */
  sent: Record<string, [number, number]>;
  unknownTypes: Record<string, number>;
  malformedLines: number;
  lastSyncAt: string | null;
  lastUploadAt: string | null;
  lastError: string | null;
}

const SENT_RETENTION_SEC = 3 * 24 * 3600;

export function emptyState(): State {
  return {
    version: 1,
    files: {},
    sent: {},
    unknownTypes: {},
    malformedLines: 0,
    lastSyncAt: null,
    lastUploadAt: null,
    lastError: null,
  };
}

export function loadState(): State {
  return { ...emptyState(), ...(readJson<State>(files.state()) ?? {}) };
}

export function saveState(s: State): void {
  const cutoff = Date.now() / 1000 - SENT_RETENTION_SEC;
  for (const [k, v] of Object.entries(s.sent)) if (v[1] < cutoff) delete s.sent[k];
  writeJsonAtomic(files.state(), s);
}
