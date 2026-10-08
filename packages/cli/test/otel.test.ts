import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installOtel, otelEnv, uninstallOtel } from "../src/otel";
import type { Credentials } from "../src/store";

const creds = { server: "https://obs.example.com/", token: "cob_abc" } as Credentials;
let root: string;
beforeEach(() => (root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-obs-otel-"))));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("otel settings", () => {
  it("merges into existing settings, keeps other keys, and backs up", () => {
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ model: "opus", env: { FOO: "1" } }));
    const r = installOtel(creds, { root });
    const s = JSON.parse(fs.readFileSync(r.file, "utf8"));
    expect(s.model).toBe("opus");
    expect(s.env.FOO).toBe("1");
    expect(s.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("https://obs.example.com/api/otlp");
    expect(s.env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer cob_abc");
    expect(s.env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
    expect(r.backup && fs.existsSync(r.backup)).toBe(true);
  });
  it("refuses to overwrite someone else's collector without --force", () => {
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://corp-collector" } }));
    expect(() => installOtel(creds, { root })).toThrow(/--force/);
    expect(() => installOtel(creds, { root, force: true })).not.toThrow();
  });
  it("uninstall removes only our keys", () => {
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ env: { FOO: "1", ...otelEnv(creds) } }));
    uninstallOtel({ root });
    expect(JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).env).toEqual({ FOO: "1" });
  });
});
