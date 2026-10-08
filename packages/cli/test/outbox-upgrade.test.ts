import type { IngestBatch } from "@claude-obs/shared";
import { describe, expect, it } from "vitest";
import { upgradeQueuedBatch } from "../src/sync";

const base: IngestBatch = {
  schemaVersion: 1,
  accountHash: "a".repeat(64),
  plan: null,
  device: { os: "darwin-arm64", ccVersions: [] },
  parser: { version: "1.0.0", unknownTypes: {}, malformedLines: 0 },
  records: [],
};

describe("batches queued by an older collector", () => {
  const proofs = new Map([["a".repeat(64), "p".repeat(64)]]);
  it("get the e-mail proof of the same Claude account", () => {
    expect(upgradeQueuedBatch(base, proofs).accountEmailProof).toBe("p".repeat(64));
  });
  it("are left alone when they belong to another account", () => {
    expect(upgradeQueuedBatch({ ...base, accountHash: "b".repeat(64) }, proofs).accountEmailProof).toBeUndefined();
  });
  it("keep an existing proof", () => {
    expect(upgradeQueuedBatch({ ...base, accountEmailProof: "c".repeat(64) }, proofs).accountEmailProof).toBe("c".repeat(64));
  });
});
