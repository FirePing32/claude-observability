import type { UsageRecord } from "@claude-obs/shared";
import { describe, expect, it } from "vitest";
import { mergeOtel, mergeTranscript, type OtelRequest } from "../src/lib/merge";

const u = (o: Partial<UsageRecord> = {}): UsageRecord => ({
  kind: "usage",
  requestId: "req_1",
  messageId: "msg_1",
  sessionId: "s1",
  ts: "2026-10-01T10:00:00.000Z",
  model: "claude-opus-5-5",
  isSubagent: false,
  agentId: null,
  input: 10,
  output: 100,
  cacheRead: 1000,
  cacheWrite5m: 0,
  cacheWrite1h: 500,
  thinking: null,
  webSearch: 0,
  webFetch: 0,
  serviceTier: "standard",
  speed: "standard",
  inferenceGeo: null,
  effort: "high",
  agentType: null,
  skill: null,
  plugin: null,
  entrypoint: "cli",
  ccVersion: "2.1.289",
  project: "p",
  gitBranch: "main",
  ...o,
});
const otel = (o: Partial<OtelRequest> = {}): OtelRequest => ({
  requestId: "req_1",
  sessionId: "s1",
  ts: new Date("2026-10-01T10:00:00Z"),
  model: "claude-opus-5-5",
  input: 10,
  output: 120,
  cacheRead: 1000,
  cacheCreation: 500,
  costUsd: 0.01,
  durationMs: 4200,
  speed: "standard",
  effort: "high",
  querySource: "repl_main_thread",
  agentType: null,
  skill: null,
  plugin: null,
  ccVersion: "2.1.289",
  ...o,
});

describe("mergeTranscript", () => {
  it("prices a new request from the price book", () => {
    const { row, changed } = mergeTranscript(undefined, u(), "ws", "dev");
    expect(changed).toBe(true);
    // Opus 5.5: 10*4 + 100*20 + 1000*0.2 + 500*8 per MTok
    expect(row.valueUsd).toBeCloseTo((40 + 2000 + 200 + 4000) / 1e6, 12);
    expect(row.sources).toEqual(["transcript"]);
  });
  it("treats a repeat with equal output as a duplicate and keeps the larger streamed output", () => {
    const first = mergeTranscript(undefined, u({ output: 300 }), "ws", "dev").row;
    expect(mergeTranscript(first, u({ output: 300 }), "ws", "dev2").changed).toBe(false);
    expect(mergeTranscript(first, u({ output: 50 }), "ws", "dev2").changed).toBe(false);
    const grown = mergeTranscript(first, u({ output: 900 }), "ws", "dev2");
    expect(grown.changed).toBe(true);
    expect(grown.row.output).toBe(900);
    expect(grown.row.deviceId).toBe("dev"); // first reporter kept
  });
  it("keeps OTel-only fields and replaces OTel token approximations with the transcript split", () => {
    const fromOtel = mergeOtel(undefined, otel(), "ws", "dev").row;
    expect(fromOtel.cacheWrite5m).toBe(500);
    const merged = mergeTranscript(fromOtel, u(), "ws", "dev").row;
    expect(merged.cacheWrite5m).toBe(0);
    expect(merged.cacheWrite1h).toBe(500);
    expect(merged.output).toBe(120); // max of otel 120 and transcript 100
    expect(merged.durationMs).toBe(4200);
    expect(merged.querySource).toBe("repl_main_thread");
    expect(merged.sources).toEqual(["otel", "transcript"]);
  });
});

describe("mergeOtel", () => {
  it("adds latency to an existing transcript row without touching its tokens", () => {
    const t = mergeTranscript(undefined, u(), "ws", "dev").row;
    const m = mergeOtel(t, otel({ output: 100 }), "ws", "dev").row;
    expect(m.cacheWrite1h).toBe(500);
    expect(m.durationMs).toBe(4200);
    expect(m.valueUsd).toBe(t.valueUsd);
  });
  it("creates a row for side requests that never reach transcripts", () => {
    const { row } = mergeOtel(undefined, otel({ requestId: "req_side", model: "claude-haiku-4-5", querySource: "generate_session_title" }), "ws", "dev");
    expect(row.sources).toEqual(["otel"]);
    expect(row.valueUsd).toBeGreaterThan(0);
  });
});
