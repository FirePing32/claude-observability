import { describe, expect, it } from "vitest";
import { emailProof } from "../src/account";

// Must equal apps/web/src/lib/email-check.ts emailProof() for the same input (see the twin test there).
const VECTOR = "4c16d27f3685266b8f449c3e5e448eb2afb45567236e368bce3f1694e907e6b1";

describe("email proof", () => {
  it("is a stable, case- and whitespace-insensitive sha256", () => {
    expect(emailProof("test@example.com")).toBe(VECTOR);
    expect(emailProof("  Test@Example.COM ")).toBe(VECTOR);
    expect(emailProof("other@example.com")).not.toBe(VECTOR);
  });
});
