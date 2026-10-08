# `claude-obs`: Collector Agent Spec

> **Status (v0.1.0, built):** C1–C4 are done and tested on real data. C5 (standalone binaries, Homebrew, signed installers) is not done; Node 20+ is required for now. The as-built layout is a single `src/` folder: `index.ts` (commands), `parse.ts`, `reader.ts`, `discover.ts`, `sync.ts` (collect/outbox/flush), `watch.ts`, `agent.ts`, `otel.ts`, `store.ts`, `account.ts`, `api.ts`, `lock.ts`, `log.ts`.

`claude-obs` is a small local agent. It reads Claude Code's session transcripts on a machine and uploads **usage-only** records to the Claude Observability app. It is the primary data source for Max/Pro accounts (see [PLAN.md](../PLAN.md) §1, §3 and §4.1).

---

## 1. Goals and non-goals

**Goals**
- **Correct account totals.** Every API request counted exactly once, across all machines and all of each machine's history.
- **Zero configuration** once enrolled. The background agent keeps the dashboard within seconds of real time.
- **Provable privacy.** No prompt, response, thinking, tool I/O, file contents or full paths ever leave the machine.
- **Robust to Claude Code updates.** The transcript format is internal and undocumented.
- **Light.** Near-zero idle CPU, under 80 MB RSS, full-history import of 50 MB in under 10 s.

**Non-goals**
- Reading claude.ai chat usage. It isn't stored locally.
- Handling Claude credentials. The agent never reads OAuth tokens, the keychain or `.credentials.json`.
- Per-person attribution. Machines belong to the account (PLAN §3).

---

## 2. Facts from real transcripts on this machine

These shape the parser:

| Observation | Consequence |
|---|---|
| 3,301 assistant lines but only **1,889 unique `requestId`s** | Claude Code writes one line per content block and repeats `usage` on each. Naive summing overcounts by about 75%. |
| For 39 requests, `output_tokens` differs between lines of the same request, and the **last line is always the largest** | These are streaming updates. Keep the **max**, and never sum. |
| `input`/`cache_read`/`cache_creation` are identical across a request's lines; `message.id` is 1:1 with `requestId` | `requestId` is the dedup key |
| No request appeared in more than one file | Resumed sessions don't copy usage lines today. Server dedup covers it if that changes. |
| Subagents are stored at `<project>/<sessionId>/subagents/agent-*.jsonl` | These files must be walked too |
| `model == "<synthetic>"` lines have `isApiErrorMessage` + `error` (`authentication_failed`, `invalid_request`/"Prompt is too long", `unknown`) | Exclude from usage; emit as error events |
| `entrypoint` ∈ {`cli`, `claude-desktop`} | One collector covers both |
| Record types include `cost-state`, `ai-title`, `custom-title`, `system` (`turn_duration`, `compact_boundary`, `away_summary`, …), `agent-name`, `mode`, `permission-mode`, … | Parse an allowlist; count the rest as "unknown" |
| `~/.claude.json` → `oauthAccount` has `accountUuid`, `organizationRateLimitTier`, `seatTier`, `billingType` | Used for the account check and plan detection. Email and name are **never read into output**. |

---

## 3. Commands

| Command | What it does |
|---|---|
| `claude-obs login --code XXXX-XXXX [--name "Studio Mac"]` | Enroll this machine with an owner-issued code |
| `claude-obs login` | Enroll through the device-code flow: prints a URL and code; a workspace owner approves in the browser |
| `claude-obs sync` | One-shot incremental upload of everything new since the last run. The first run imports the full history, with a progress bar. |
| `claude-obs sync --watch` | Foreground watcher; uploads within about 2–5 s of new lines |
| `claude-obs sync --dry-run [--json]` | Parses and prints exactly what *would* be uploaded. Sends nothing. |
| `claude-obs install-agent` / `uninstall-agent` | Installs or removes the background service (launchd / systemd user unit / Windows Task Scheduler) running `sync --watch` |
| `claude-obs status` | Workspace, device name, account match, config dirs, last upload, pending records, parser warnings, agent running? |
| `claude-obs config-dirs add <path>` / `list` / `remove` | Register extra `CLAUDE_CONFIG_DIR` folders on this machine (they share the machine's single enrollment) |
| `claude-obs otel --print` / `--install [--force]` / `--uninstall` | Show, or merge into `~/.claude/settings.json` (with a backup), the OpenTelemetry env block carrying this machine's token. Refuses to replace another collector without `--force`. |
| `claude-obs config [titles on\|off] [hash-projects on\|off]` | Privacy switches |
| `claude-obs show-last-upload` | Prints the last uploaded batch, for an audit trail |
| `claude-obs resync [--since 2026-09-01]` | Clears local offsets and re-uploads. Safe, because the server dedups. |
| `claude-obs logout` | Revokes the device token server-side and deletes local credentials and state |
| `claude-obs doctor` | Checks the environment: Node/binary version, file permissions, server reachability, clock skew, watcher support |

**Global flags**
- `--server <url>`: default is the production app URL.
- `--no-titles`: don't upload session titles.
- `--hash-projects`: replace project names with salted hashes.
- `--verbose`, `--quiet`.

**Environment variables**
- `CLAUDE_OBS_SERVER` and `CLAUDE_OBS_TOKEN`, for CI or headless boxes.
- `CLAUDE_CONFIG_DIR` is honored.

---

## 4. Files on disk

```
~/.config/claude-obs/            (macOS/Linux; %APPDATA%\claude-obs on Windows)
  credentials.json   0600  { server, deviceId, token, workspaceId }
  config.json              { configDirs: ["~/.claude", …], titles: true, hashProjects: false }
  state.json               file offsets, recent requestId → max output sent (pruned after 3 days), counters
  outbox/*.json            durable queue of unsent batches (one file per batch, written atomically)
  last-upload.json         the last batch the server accepted, for `show-last-upload`
  agent.lock               single-instance lock (pid)
  logs/agent.log           rotated, 5 × 1 MB, no content
```

- **State is plain JSON written via temp-file + fsync + rename**, with no native dependencies, so `npx` works everywhere. The built collector is a single bundled file.
- The **hash salt is per workspace**, handed out at enrollment (`hashSalt`). Every machine on the account therefore produces the same account hash and project hashes. A per-machine salt would make "same account?" undecidable.

---

## 5. Pipeline

```
discover → tail → parse → reduce (dedup) → outbox → upload → ack → advance offsets
```

### 5.1 Discover
- **Roots**: each folder in `configDirs`, defaulting to `$CLAUDE_CONFIG_DIR` or `~/.claude`.
- **Globs**: `projects/*/*.jsonl` and `projects/*/*/subagents/*.jsonl`.
- **Account file**: `<root>/../.claude.json` for the default root, or `<root>/.claude.json` when `CLAUDE_CONFIG_DIR` is set. Resolution is tested on each OS.
- The account hash is computed per root. A root whose account doesn't match the enrolled account is **skipped, with a warning** in `status`.

### 5.2 Tail (incremental reads)
- State per file: `{path, dev, inode, size, offset, mtime}`.
- Read from `offset` to EOF. Only **complete lines** are consumed: a trailing partial line waits for the next pass.
- **File rotated or truncated** (inode changed, or size < offset): re-read from 0. The server dedups, so this is safe.
- **File moved** (same inode, new path; Claude Code has a `relocated` record type): update the path and keep the offset.
- **Watching**:
  - `fs.watch(root, {recursive: true})` on macOS and Windows, and on Linux with Node ≥ 20.
  - Fallback: poll every 5 s by `stat` size/mtime.
  - Events are debounced for 1.5 s per file.

### 5.3 Parse: an allowlist only
Each line goes through `JSON.parse` inside try/catch; malformed lines are counted, never fatal. Records are dispatched on `type`:

| Input | Output record |
|---|---|
| `assistant`, `model ≠ <synthetic>` | `usage` (§6.1) |
| `assistant`, `model == <synthetic>`, `isApiErrorMessage` | `error` (§6.3). Limit messages become `limit`, with `resetsAt` parsed when present. |
| `cost-state` | `session_snapshot`: Claude Code's own totals (cost, durations, LOC, per-model usage including `thinkingTokens`) |
| `ai-title` / `custom-title` | `session_meta.title`; `custom-title` wins. Skipped with `--no-titles`. |
| `system` / `compact_boundary` | `session_event{kind:"compaction"}` |
| `system` / `turn_duration` | `session_event{kind:"turn", durationMs}` |
| `agent-name` | `session_meta.agentName` for subagent files |
| anything else | counted in `unknownTypes[type]++`, and reported in `status` and in upload metadata |

**Output records are built field by field from explicit paths**: no object spreading, no copying of `message`. This is the main privacy guarantee, and a unit test enforces it by asserting that serialized output never contains known content strings from the fixtures.

### 5.4 Reduce (client-side dedup)
- Group by `requestId`, using a per-request cache in `state.json`, and keep the line with the **max `output_tokens`** (the latest wins on ties).
- A request is sent when first seen, and **re-sent only if its `output_tokens` grew**. That keeps `--watch` accurate while a response is still streaming.
- The server is still authoritative: it upserts with `GREATEST()`, so out-of-order batches can't lower a value.

### 5.5 Outbox, upload, ack
- Batches are written to `outbox/` **before** offsets are committed to `state.json`. A crash between the two only re-reads and re-queues lines, and the server deduplicates them, so a crash means a resend, never a loss. The outbox is flushed in order and survives being offline.
- **Batching**: up to 500 records or 256 KB, gzip, flushed every 2 s in watch mode.
- **Retries**: exponential backoff with jitter (1 s → 5 min max) on network errors, 5xx and 429 (honoring `Retry-After`). While offline, the outbox simply grows.
- **Non-retryable responses**:
  - `401` (token revoked): stop and tell the user to log in again.
  - `409 account_mismatch`: skip that root.
  - `422 schema`: quarantine the batch, log the reason, continue.
  - `426 upgrade_required`: the CLI is older than the server's minimum version.

---

## 6. Wire format (`packages/shared`, Zod: the same schema on the CLI and the server)

`POST /api/ingest/transcripts` with headers `Authorization: Bearer <token>`, `Content-Encoding: gzip`, `X-Claude-Obs-Version: 1.0.0`:

```jsonc
{
  "schemaVersion": 1,
  "device": { "ccVersions": ["2.1.289"], "os": "darwin" },
  "accountHash": "hmac-sha256(salt, accountUuid)",
  "plan": { "rateLimitTier": "…", "seatTier": "…", "billingType": "…" },   // from oauthAccount, optional
  "parser": { "version": "1.0.0", "unknownTypes": { "atis-latch": 98 }, "malformedLines": 0 },
  "records": [ /* usage | error | limit | session_meta | session_snapshot | session_event */ ]
}
```

### 6.1 `usage`
```jsonc
{ "kind": "usage", "requestId": "req_…", "messageId": "msg_…", "sessionId": "uuid", "ts": "2026-10-08T09:12:44.120Z",
  "model": "claude-opus-5-5", "isSubagent": false, "agentId": null,
  "input": 2, "output": 294, "cacheRead": 41200, "cacheWrite5m": 0, "cacheWrite1h": 4671,
  "webSearch": 0, "webFetch": 0, "serviceTier": "standard", "speed": "standard", "effort": "high",
  "entrypoint": "claude-desktop", "ccVersion": "2.1.289", "project": "harness-api", "gitBranch": "main" }
```
- `project` is the basename of `cwd`, or `h:<hash>` with `--hash-projects`.
- **Never sent**: the full `cwd`, the content, `parentUuid` chains, or `uuid`.

### 6.2 Session records
- `session_meta {sessionId, title?, agentName?, firstTs, lastTs}`
- `session_snapshot {sessionId, ts, totalCostUSD, apiMs, toolMs, linesAdded, linesRemoved, modelUsage}`
- `session_event {sessionId, ts, kind: "compaction" | "turn", durationMs?}`

### 6.3 `error` / `limit`
- `error {sessionId, ts, code, reasonClass}`, where `reasonClass` is one of `prompt_too_long | auth | network | rate_limit | overloaded | other`. It is classified locally, and the raw text is not sent.
- `limit {sessionId, ts, limitKind: "five_hour" | "weekly" | "unknown", resetsAt?}`

### 6.4 Response
```jsonc
{ "accepted": 498, "deduplicated": 2, "minCliVersion": "1.0.0", "serverTime": "…" }
```
`serverTime` lets `doctor` warn about clock skew. Block math uses the record `ts`, not the server receive time.

### 6.5 Enrollment endpoints
- `POST /api/cli/enroll {code, name, os}` → `{deviceId, token, workspaceId}`
- `POST /api/cli/device/start {name, os}` → `{userCode, verificationUrl, deviceCode, interval}`
- `POST /api/cli/device/poll {deviceCode}` → `pending | {deviceId, token, workspaceId}`
- `DELETE /api/cli/device` (Bearer): logout/revoke

---

## 7. Background agent

| OS | Mechanism | Unit |
|---|---|---|
| macOS | `launchd` LaunchAgent | `~/Library/LaunchAgents/com.claude-obs.agent.plist`, `RunAtLoad`, `KeepAlive`, `ProcessType=Background`, low priority (`Nice=10`) |
| Linux | systemd **user** unit | `~/.config/systemd/user/claude-obs.service`, `Restart=on-failure`, `Nice=10`; `loginctl enable-linger` suggested for remote dev boxes |
| Windows | Task Scheduler | at logon, restart on failure |

- Single-instance lock (`agent.lock` PID file, released on exit and on SIGINT/SIGTERM/SIGHUP; stale locks are detected). A second `sync` process just triggers the running one.
- The agent rescans everything every 15 min, as a safety net for missed watch events.

---

## 8. Distribution

Claude Code's native installer doesn't require Node, so `npx` can't be assumed. Ship both:
- **npm**: `npx claude-obs` / `npm i -g claude-obs`. Node ≥ 20, ESM, built with `tsup`, published with **npm provenance**.
- **Standalone binaries** (macOS arm64/x64, Linux x64/arm64, Windows x64), built with `bun build --compile`:
  - attached to GitHub Releases with SHA-256 checksums;
  - a Homebrew tap (`brew install <org>/tap/claude-obs`);
  - an install script (`curl -fsSL https://<app>/install.sh | sh`) that verifies the checksum;
  - macOS binaries are code-signed and notarized.
- **Versioning**: semver. The server publishes `minCliVersion`. `status` notifies about updates, but nothing auto-updates.

---

## 9. Package layout

```
packages/cli/
  src/
    index.ts                 command router (citty or commander)
    commands/{login,sync,status,install-agent,config-dirs,dry-run,doctor,logout,resync}.ts
    discover/roots.ts        config dirs, CLAUDE_CONFIG_DIR, .claude.json resolution
    discover/account.ts      read oauthAccount → {hash, tiers}; never returns email/name
    store.ts                 credentials / config / state.json (atomic writes)
    tail/reader.ts           offset-based line reader, partial-line handling, inode checks
    tail/watch.ts            fs.watch recursive + polling fallback + debounce
    parse/index.ts           dispatch by type → allowlisted builders
    parse/{assistant,synthetic,costState,titles,system,agentName}.ts
    reduce/dedupe.ts         per-request max(output) logic
    upload/client.ts         batching, gzip, retries, error mapping
    agent/{launchd,systemd,windows}.ts
    util/{hash,log,paths}.ts
  test/
    fixtures/<ccVersion>/…   scrubbed real transcripts (content replaced with lorem)
packages/shared/src/ingest.ts   Zod schemas (wire format) + TS types
```

**Dependencies**: none at runtime. `zod` and the shared schema are bundled by `tsup`; argument parsing is `node:util` `parseArgs`; HTTP is the built-in `fetch`. No telemetry SDKs, and no analytics about the CLI itself.

---

## 10. Testing

- **Golden fixtures** per Claude Code version: asserted totals per session and per model, including:
  - the 1,889-out-of-3,301 dedup case
  - the 39 streaming-growth cases
  - subagent files and `<synthetic>` errors
  - compaction, `cost-state` and unknown types
- **Privacy test**: fixture content contains canary strings; no serialized upload may contain them.
- **Crash safety**: kill the process between the outbox write and the ack, restart, and assert no loss and no double count after server dedup.
- **Rotation, truncation, relocation and partial-line** tests on a temp folder.
- **Watch-mode E2E**: append lines in real time and assert upload within 5 s, plus a correct final `output` after streaming growth.
- **Cross-check against `cost-state`, which turned out weak**: it covers only the *last process run* of a session (resumes reset it), and it includes side requests (titles, classifiers) that transcripts never log. On real data, single-run sessions matched to the cent; others differed by 5–9% (side requests) or a lot (resumed sessions). The dashboard shows it as "Claude Code's own accounting (last run)", not as a pass/fail check. **For exact totals, enable OpenTelemetry** (`claude-obs otel --install`).
- **Drift canary (CI, nightly)**: install the latest Claude Code, generate a tiny session, run the parser, and fail on new or missing fields.
- **OS matrix**: macOS, Ubuntu, Windows, on Node 20/22 plus the compiled binaries.

---

## 11. Milestones

| # | Deliverable | Done when |
|---|---|---|
| C1 | Parser + reducer + `--dry-run` | Matches the reference totals on this Mac's 44 MB history (1,889 requests) |
| C2 | Enrollment (code + device flow), `sync`, outbox, server ingest endpoint | Full history appears in the dashboard; a re-run uploads 0 new records |
| C3 | `--watch`, `install-agent` (macOS first), `status`, `doctor` | A live session shows on the dashboard within 5 s; the agent survives reboot |
| C4 | Multi-root (`config-dirs`), account-hash check, `--hash-projects`, `--no-titles` | A second account's folder is skipped; options verified by the dry run |
| C5 | Binaries, Homebrew, install script, Linux + Windows agents | Clean install on all 3 OSes with no Node present |

---

## 12. Open questions

- **Exact limit-message text.** Not yet seen in local data. Capture one real occurrence to finalize the `limit` classifier and `resetsAt` parsing.
- **`.claude.json` location** under a custom `CLAUDE_CONFIG_DIR`, across Claude Code versions. Verify on each OS in C4.
- **Windows desktop app transcript path.** Assumed to be `%USERPROFILE%\.claude`. Verify.
