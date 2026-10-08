import { describe, expect, it } from "vitest";
import { emailProof } from "../src/lib/email-check";

// Must equal packages/cli/src/account.ts emailProof() for the same input (see the twin test there).
const VECTOR = "4c16d27f3685266b8f449c3e5e448eb2afb45567236e368bce3f1694e907e6b1";

describe("email proof", () => {
  it("matches the collector's computation", () => {
    expect(emailProof("TEST@example.com")).toBe(VECTOR);
  });
});
