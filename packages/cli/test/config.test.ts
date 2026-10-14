import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DEFAULT_UPLOAD_INTERVAL_MIN, loadConfig, saveConfig } from "../src/store";

let home: string;
const prev = process.env.CLAUDE_OBS_HOME;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-obs-config-"));
  process.env.CLAUDE_OBS_HOME = home;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  if (prev === undefined) delete process.env.CLAUDE_OBS_HOME;
  else process.env.CLAUDE_OBS_HOME = prev;
});

test("upload interval defaults to 10 minutes, including for configs written by older versions", () => {
  expect(loadConfig().uploadIntervalMin).toBe(DEFAULT_UPLOAD_INTERVAL_MIN);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ configDirs: ["/tmp/x"], titles: true, hashProjects: false }));
  expect(loadConfig().uploadIntervalMin).toBe(10);
});

test("upload interval is saved and clamped to 1–60 minutes", () => {
  saveConfig({ ...loadConfig(), uploadIntervalMin: 15 });
  expect(loadConfig().uploadIntervalMin).toBe(15);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ uploadIntervalMin: 0 }));
  expect(loadConfig().uploadIntervalMin).toBe(1);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ uploadIntervalMin: 500 }));
  expect(loadConfig().uploadIntervalMin).toBe(60);
});
