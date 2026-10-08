import fs from "node:fs";
import type { FileState } from "./store";

const CHUNK = 1 << 20; // 1 MiB

export interface ReadResult {
  state: FileState;
  /** True when the file was re-read from the start (new file, rotated, or truncated). */
  restarted: boolean;
  bytes: number;
}

/**
 * Reads complete lines appended since `prev.offset`. A trailing line without
 * "\n" is left for the next pass, so a line being written is never half-read.
 * Lines are decoded per line from bytes, so multi-byte characters never split.
 */
export function readNewLines(file: string, prev: FileState | undefined, onLine: (line: string) => void): ReadResult | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    const same = prev && prev.ino === st.ino && prev.dev === st.dev && prev.offset <= st.size;
    const start = same ? prev.offset : 0;
    let pos = start;
    let committed = start;
    let carry: Buffer = Buffer.alloc(0);
    const buf = Buffer.allocUnsafe(CHUNK);
    while (pos < st.size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, st.size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const data: Buffer = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let lineStart = 0;
      let nl = data.indexOf(10, lineStart);
      while (nl !== -1) {
        onLine(data.toString("utf8", lineStart, nl));
        committed += nl - lineStart + 1;
        lineStart = nl + 1;
        nl = data.indexOf(10, lineStart);
      }
      carry = Buffer.from(data.subarray(lineStart)); // copy: `buf` is reused next iteration
    }
    return {
      state: { dev: st.dev, ino: st.ino, offset: committed },
      restarted: !same,
      bytes: committed - start,
    };
  } finally {
    fs.closeSync(fd);
  }
}
