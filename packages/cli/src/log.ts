import fs from "node:fs";
import path from "node:path";
import { files } from "./paths";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export function consoleLogger(opts: { verbose?: boolean; quiet?: boolean } = {}): Logger {
  return {
    info: (m) => !opts.quiet && console.log(m),
    warn: (m) => console.warn(`warning: ${m}`),
    error: (m) => console.error(`error: ${m}`),
    debug: (m) => opts.verbose && console.log(`· ${m}`),
  };
}

const MAX_LOG_BYTES = 1_000_000;
const KEEP = 5;

/** File logger for the background agent: 5 × 1 MB rotation, never logs record contents. */
export function fileLogger(verbose = false): Logger {
  const dir = files.logDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "agent.log");
  const write = (level: string, m: string) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
        for (let i = KEEP - 1; i >= 1; i--) {
          const from = `${file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
        }
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${m}\n`, { mode: 0o600 });
    } catch {
      /* logging must never crash the agent */
    }
  };
  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
    debug: (m) => verbose && write("DEBUG", m),
  };
}
