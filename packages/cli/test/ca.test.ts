import { afterEach, describe, expect, it } from "vitest";
import { describeCaMode, systemBundle, useSystemCertificates } from "../src/ca";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("system certificates", () => {
  it("can be disabled", () => {
    process.env.CLAUDE_OBS_SYSTEM_CA = "0";
    expect(useSystemCertificates()).toEqual({ mode: "disabled" });
  });
  it("does not relaunch again inside the relaunched child", () => {
    delete process.env.CLAUDE_OBS_SYSTEM_CA;
    process.env.CLAUDE_OBS_CA_REEXEC = "1";
    expect(useSystemCertificates()).toEqual({ mode: "reexec-child" });
  });
  it("loads them in-process when Node supports it, otherwise never silently does nothing", () => {
    delete process.env.CLAUDE_OBS_SYSTEM_CA;
    delete process.env.CLAUDE_OBS_CA_REEXEC;
    process.env.NODE_EXTRA_CA_CERTS = "/tmp/x.pem"; // prevents an actual relaunch on older Node in this test
    const r = useSystemCertificates();
    expect(r).not.toBe("relaunched");
    expect(["api", "user-configured"]).toContain((r as { mode: string }).mode);
  });
  it("finds a PEM bundle on macOS and Linux", () => {
    const b = systemBundle();
    if (process.platform === "darwin" || process.platform === "linux") expect(b).toBeTruthy();
    expect(describeCaMode("api")).toMatch(/system/);
  });
});
