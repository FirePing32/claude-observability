import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestBatch, type UsageRecord } from "@claude-obs/shared";
import { hashAccount } from "../src/account";
import { classifyReason, parseLimit, parseResetsAt } from "../src/parse";
import { emptyState, type Config, type State } from "../src/store";
import { collect } from "../src/sync";

const CANARY = "CANARY_SECRET_7f3a";
const CWD = `/Users/alice/${CANARY}-dir/harness-api`;
const SESSION = "11111111-2222-3333-4444-555555555555";
const ACCOUNT = "acct-uuid-123";

let root: string;
let config: Config;

const assistant = (requestId: string, output: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    requestId,
    timestamp: "2026-10-01T10:00:00.000Z",
    cwd: CWD,
    gitBranch: "main",
    version: "2.1.289",
    entrypoint: "cli",
    effort: "high",
    uuid: `u-${requestId}-${output}`,
    message: {
      id: `msg_${requestId}`,
      model: "claude-opus-5-5",
      content: [{ type: "text", text: `${CANARY} assistant text` }, { type: "tool_use", input: { cmd: `cat ${CANARY}` } }],
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
        output_tokens_details: { thinking_tokens: 5 },
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
        service_tier: "standard",
        speed: "standard",
        inference_geo: "not_available",
      },
    },
    ...extra,
  });

const lines = (...ls: string[]) => ls.join("\n") + "\n";
const projectDir = () => path.join(root, "projects", "-Users-alice-harness-api");
const mainFile = () => path.join(projectDir(), `${SESSION}.jsonl`);
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const usageOf = (c: ReturnType<typeof collect>) =>
  c.batches.flatMap((b) => b.records).filter((r): r is UsageRecord => r.kind === "usage");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-obs-test-"));
  fs.writeFileSync(
    path.join(root, ".claude.json"),
    JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: `${CANARY}@example.com`, organizationRateLimitTier: "default_claude_max_5x" } }),
  );
  config = { configDirs: [root], titles: true, hashProjects: false };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("collect", () => {
  it("collapses repeated content-block lines and keeps the final streaming output", () => {
    write(mainFile(), lines(assistant("req_A", 3), assistant("req_A", 3), assistant("req_A", 294), assistant("req_B", 50)));
    const c = collect(config, emptyState(), "salt");
    const usage = usageOf(c);
    expect(usage).toHaveLength(2);
    const a = usage.find((u) => u.requestId === "req_A")!;
    expect(a.output).toBe(294);
    expect(a.cacheWrite5m).toBe(100);
    expect(a.cacheWrite1h).toBe(200);
    expect(a.thinking).toBe(5);
    expect(a.webSearch).toBe(1);
    expect(a.project).toBe("harness-api");
    expect(a.effort).toBe("high");
    expect(c.roots[0]!.acc.duplicateLines).toBe(2);
  });

  it("produces batches that pass the server schema, with the salted account hash", () => {
    write(mainFile(), lines(assistant("req_A", 3)));
    const c = collect(config, emptyState(), "salt");
    for (const b of c.batches) expect(ingestBatch.safeParse(b).success).toBe(true);
    expect(c.batches[0]!.accountHash).toBe(hashAccount("salt", ACCOUNT));
    expect(c.batches[0]!.plan?.rateLimitTier).toBe("default_claude_max_5x");
    expect(c.batches[0]!.accountEmailProof).toMatch(/^[0-9a-f]{64}$/); // proof, not the e-mail
  });

  it("never uploads content, emails or full paths", () => {
    write(
      mainFile(),
      lines(
        JSON.stringify({ type: "user", sessionId: SESSION, message: { content: `${CANARY} prompt` } }),
        assistant("req_A", 3),
        JSON.stringify({ type: "system", subtype: "away_summary", content: `${CANARY} summary`, sessionId: SESSION, timestamp: "2026-10-01T10:00:00Z" }),
        JSON.stringify({
          type: "assistant",
          sessionId: SESSION,
          timestamp: "2026-10-01T10:01:00Z",
          isApiErrorMessage: true,
          error: "invalid_request",
          message: { model: "<synthetic>", content: [{ type: "text", text: `Prompt is too long ${CANARY}` }] },
        }),
      ),
    );
    const serialized = JSON.stringify(collect(config, emptyState(), "salt").batches);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain("/Users/alice");
  });

  it("separates subagent files and reads their agent type", () => {
    const sub = path.join(projectDir(), SESSION, "subagents", "agent-abc123.jsonl");
    write(sub, lines(assistant("req_S", 7, { isSidechain: true })));
    fs.writeFileSync(sub.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "general-purpose", description: CANARY }));
    const [u] = usageOf(collect(config, emptyState(), "salt"));
    expect(u!.isSubagent).toBe(true);
    expect(u!.agentId).toBe("abc123");
    expect(u!.agentType).toBe("general-purpose");
  });

  it("turns synthetic API errors into error/limit records and skips them as usage", () => {
    const err = (text: string, error: string, uuid: string) =>
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        uuid,
        timestamp: "2026-10-01T10:01:00Z",
        isApiErrorMessage: true,
        error,
        message: { model: "<synthetic>", content: [{ type: "text", text }] },
      });
    write(
      mainFile(),
      lines(
        err("Prompt is too long", "invalid_request", "e1"),
        err("Login expired · Please run /login", "authentication_failed", "e2"),
        err("You've hit your limit · resets 3pm", "rate_limit", "e3"),
        JSON.stringify({ type: "assistant", sessionId: SESSION, timestamp: "2026-10-01T10:02:00Z", message: { model: "<synthetic>", content: "No response requested." } }),
      ),
    );
    const recs = collect(config, emptyState(), "salt").batches.flatMap((b) => b.records);
    expect(recs.filter((r) => r.kind === "usage")).toHaveLength(0);
    const errors = recs.filter((r) => r.kind === "error");
    expect(errors.map((e) => e.kind === "error" && e.reasonClass).sort()).toEqual(["auth", "prompt_too_long"]);
    const limits = recs.filter((r) => r.kind === "limit");
    expect(limits).toHaveLength(1);
  });

  it("prefers a custom title over the generated one and honours titles=off", () => {
    write(
      mainFile(),
      lines(
        JSON.stringify({ type: "custom-title", customTitle: "My title", sessionId: SESSION }),
        JSON.stringify({ type: "ai-title", aiTitle: "Generated title", sessionId: SESSION }),
      ),
    );
    const meta = collect(config, emptyState(), "salt").batches.flatMap((b) => b.records).find((r) => r.kind === "session_meta");
    expect(meta).toMatchObject({ title: "My title", titleSource: "custom" });
    const off = collect({ ...config, titles: false }, emptyState(), "salt").batches.flatMap((b) => b.records);
    expect(off.find((r) => r.kind === "session_meta")).toBeUndefined();
  });

  it("captures compactions, turn durations and the cost-state snapshot", () => {
    write(
      mainFile(),
      lines(
        JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: SESSION, uuid: "c1", timestamp: "2026-10-01T10:00:00Z", compactMetadata: { trigger: "manual", preTokens: 244892, durationMs: 1200 } }),
        JSON.stringify({ type: "system", subtype: "turn_duration", sessionId: SESSION, uuid: "t1", timestamp: "2026-10-01T10:00:00Z", durationMs: 70951 }),
        JSON.stringify({ type: "cost-state", sessionId: SESSION, totalCostUSD: 0.39, totalAPIDuration: 100, totalToolDuration: 50, totalLinesAdded: 3, totalLinesRemoved: 1, startTime: 1790753391861, modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 2, thinkingTokens: 0, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, webSearchRequests: 0, costUSD: 0.39 } } }),
      ),
    );
    const recs = collect(config, emptyState(), "salt").batches.flatMap((b) => b.records);
    expect(recs.find((r) => r.kind === "session_event" && r.event === "compaction")).toMatchObject({ preTokens: 244892, trigger: "manual" });
    expect(recs.find((r) => r.kind === "session_event" && r.event === "turn")).toMatchObject({ durationMs: 70951 });
    expect(recs.find((r) => r.kind === "session_snapshot")).toMatchObject({ totalCostUSD: 0.39, linesAdded: 3 });
  });

  it("hashes project names consistently when asked", () => {
    write(mainFile(), lines(assistant("req_A", 3)));
    const a = usageOf(collect({ ...config, hashProjects: true }, emptyState(), "salt"))[0]!;
    const b = usageOf(collect({ ...config, hashProjects: true }, emptyState(), "salt"))[0]!;
    expect(a.project).toMatch(/^h:[0-9a-f]{12}$/);
    expect(a.project).toBe(b.project);
  });

  it("skips roots without a Claude login and counts unknown record types", () => {
    fs.rmSync(path.join(root, ".claude.json"));
    write(mainFile(), lines(assistant("req_A", 3)));
    expect(collect(config, emptyState(), "salt").roots[0]!.status).toBe("no_account");
  });
});

describe("incremental reads", () => {
  const apply = (state: State, c: ReturnType<typeof collect>) => {
    Object.assign(state.files, c.fileUpdates);
    Object.assign(state.sent, c.sentUpdates);
  };

  it("only reads appended complete lines and leaves a partial line for later", () => {
    const state = emptyState();
    write(mainFile(), lines(assistant("req_A", 3)) + assistant("req_B", 9).slice(0, 40)); // partial trailing line
    let c = collect(config, state, "salt");
    apply(state, c);
    expect(usageOf(c).map((u) => u.requestId)).toEqual(["req_A"]);

    fs.writeFileSync(mainFile(), lines(assistant("req_A", 3), assistant("req_B", 9)));
    // file rewritten with same inode: offset still valid, finishes reading req_B
    c = collect(config, state, "salt");
    apply(state, c);
    expect(usageOf(c).map((u) => u.requestId)).toEqual(["req_B"]);

    c = collect(config, state, "salt");
    expect(c.batches).toHaveLength(0);
  });

  it("re-sends a request only when its output grew (streaming across passes)", () => {
    const state = emptyState();
    write(mainFile(), lines(assistant("req_A", 3)));
    apply(state, collect(config, state, "salt"));
    fs.appendFileSync(mainFile(), lines(assistant("req_A", 3)));
    expect(usageOf(collect(config, state, "salt"))).toHaveLength(0);
    fs.appendFileSync(mainFile(), lines(assistant("req_A", 294)));
    const again = usageOf(collect(config, state, "salt"));
    expect(again).toHaveLength(1);
    expect(again[0]!.output).toBe(294);
  });

  it("restarts from zero when a file is truncated", () => {
    const state = emptyState();
    write(mainFile(), lines(assistant("req_A", 3), assistant("req_B", 3)));
    apply(state, collect(config, state, "salt"));
    state.sent = {}; // simulate an expired sent cache so re-read records are visible
    fs.writeFileSync(mainFile(), lines(assistant("req_C", 3)));
    expect(usageOf(collect(config, state, "salt")).map((u) => u.requestId)).toEqual(["req_C"]);
  });
});

describe("limit and error classification", () => {
  it("parses limit kinds and reset times", () => {
    expect(parseLimit("Claude AI usage limit reached|1790000000", "2026-10-01T10:00:00Z")).toEqual({
      kind: "five_hour",
      resetsAt: new Date(1790000000 * 1000).toISOString(),
    });
    expect(parseLimit("You've hit your weekly limit · resets Mon 9am", "2026-10-01T10:00:00Z")?.kind).toBe("weekly");
    expect(parseLimit("Prompt is too long", "2026-10-01T10:00:00Z")).toBeNull();
  });
  it("computes the next local occurrence for 'resets 3pm'", () => {
    const ts = new Date(2026, 9, 1, 16, 0, 0).toISOString(); // 4pm local
    const r = new Date(parseResetsAt("resets 3pm", ts)!);
    expect(r.getHours()).toBe(15);
    expect(r.getDate()).toBe(2); // already past 3pm → tomorrow
  });
  it("classifies error reasons", () => {
    expect(classifyReason(null, "API Error: The socket connection was closed unexpectedly")).toBe("network");
    expect(classifyReason("overloaded_error", "")).toBe("overloaded");
    expect(classifyReason(null, "something else")).toBe("other");
  });
});
