import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;

/** Device bearer token: shown once to the collector, stored only as a hash. */
export const newDeviceToken = () => `cob_${randomBytes(32).toString("base64url")}`;

// Crockford-ish alphabet: no 0/O, 1/I/L, U.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function newHumanCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const newSalt = () => randomBytes(32).toString("hex");
