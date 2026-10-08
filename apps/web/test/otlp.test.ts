import { describe, expect, it } from "vitest";
import { decodeLogs, decodeMetrics, hashAccountUuid } from "../src/lib/otlp";

const kv = (key: string, v: string | number) => ({ key, value: typeof v === "number" ? { intValue: String(v) } : { stringValue: v } });

describe("decodeLogs", () => {
  const body = {
    resourceLogs: [
      {
        resource: { attributes: [kv("service.name", "claude-code"), kv("user.account_uuid", "acct-1")] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: "1791000000000000000",
                body: { stringValue: "claude_code.api_request" },
                attributes: [
                  kv("event.name", "api_request"),
                  kv("session.id", "s1"),
                  kv("request_id", "req_9"),
                  kv("model", "claude-sonnet-5-5"),
                  kv("input_tokens", "12"),
                  kv("output_tokens", 340),
                  kv("cache_read_tokens", "5000"),
                  kv("cache_creation_tokens", "100"),
                  { key: "cost_usd", value: { doubleValue: 0.0042 } },
                  kv("duration_ms", 2100),
                  kv("query_source", "repl_main_thread"),
                  kv("prompt", "SECRET PROMPT TEXT"),
                ],
              },
              { body: { stringValue: "claude_code.api_error" }, attributes: [kv("session.id", "s1"), kv("status_code", "529"), kv("error", "Overloaded")] },
              { body: { stringValue: "claude_code.user_prompt" }, attributes: [kv("prompt", "SECRET")] },
            ],
          },
        ],
      },
    ],
  };
  it("maps api_request events and never reads content attributes", () => {
    const d = decodeLogs(body);
    expect(d.requests).toHaveLength(1);
    const r = d.requests[0]!;
    expect(r).toMatchObject({ requestId: "req_9", sessionId: "s1", model: "claude-sonnet-5-5", input: 12, output: 340, cacheRead: 5000, cacheCreation: 100, durationMs: 2100 });
    expect(r.ts.toISOString()).toBe(new Date(1791000000000).toISOString());
    expect(JSON.stringify(d.requests)).not.toContain("SECRET");
    expect(d.errors[0]!.reasonClass).toBe("overloaded");
    expect(d.ignored).toBe(1);
    expect([...d.accountUuids]).toEqual(["acct-1"]);
  });
  it("tolerates garbage", () => {
    expect(decodeLogs(null).requests).toEqual([]);
    expect(decodeLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: "nope" }] }] }] }).ignored).toBe(1);
  });
  it("hashes account ids exactly like the collector", () => {
    expect(hashAccountUuid("salt", "acct-1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("decodeMetrics", () => {
  it("keeps delta sums and skips cumulative ones", () => {
    const sum = (temporality: number, value: number) => ({
      name: "claude_code.lines_of_code.count",
      sum: { aggregationTemporality: temporality, dataPoints: [{ asInt: String(value), timeUnixNano: "1791000000000000000", attributes: [kv("type", "added")] }] },
    });
    const d = decodeMetrics({ resourceMetrics: [{ scopeMetrics: [{ metrics: [sum(1, 12), sum(2, 99), { name: "other.metric", sum: { dataPoints: [] } }] }] }] });
    expect(d.points).toEqual([expect.objectContaining({ metric: "lines_of_code.count", kind: "added", value: 12 })]);
    expect(d.cumulativeSkipped).toBe(1);
  });
});
