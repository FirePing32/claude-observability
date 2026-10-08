import { gzipSync } from "node:zlib";
import {
  apiError,
  devicePollResponse,
  deviceStartResponse,
  enrollResponse,
  ingestResponse,
  whoamiResponse,
  type IngestBatch,
  type IngestResponse,
} from "@claude-obs/shared";
import type { z } from "zod";
import { CLI_VERSION } from "./paths";

export const DEFAULT_SERVER = process.env.CLAUDE_OBS_SERVER || "https://claude-observability.vercel.app";

const CERT_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
]);

/** Turn Node's opaque "fetch failed" into the underlying cause, with a fix for TLS-inspecting networks. */
export function describeNetworkError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const code = err.cause?.code;
  if (code && CERT_ERRORS.has(code)) {
    return (
      `${code}: this network intercepts HTTPS (a corporate proxy or security agent such as Netskope or Zscaler), ` +
      `and Node.js doesn't trust its certificate. Export your company's root certificate and set NODE_EXTRA_CA_CERTS to it ` +
      `(on Node 22.15+ you can instead set NODE_USE_SYSTEM_CA=1). See "Corporate networks" in the claude-obs README.`
    );
  }
  if (code === "ENOTFOUND") return "the server name doesn't resolve (check the URL and your internet connection)";
  if (code === "ECONNREFUSED") return "connection refused (is the server URL right?)";
  return code ? `${err.message} (${code}${err.cause?.message ? `: ${err.cause.message}` : ""})` : err.message;
}

export type UploadOutcome =
  | { ok: true; res: IngestResponse }
  | { ok: false; retryable: boolean; status: number; error: string; message: string; retryAfterSec?: number };

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": `claude-obs/${CLI_VERSION} (node ${process.version}; ${process.platform})`,
    "x-claude-obs-version": CLI_VERSION,
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function failure(res: Response): Promise<UploadOutcome & { ok: false }> {
  let error = `http_${res.status}`;
  let message = res.statusText;
  try {
    const body = apiError.safeParse(await res.json());
    if (body.success) {
      error = body.data.error;
      message = body.data.message;
    }
  } catch {
    /* non-JSON error body */
  }
  const ra = Number(res.headers.get("retry-after"));
  return {
    ok: false,
    retryable: res.status === 429 || res.status >= 500,
    status: res.status,
    error,
    message,
    retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : undefined,
  };
}

export async function uploadBatch(server: string, token: string, batch: IngestBatch): Promise<UploadOutcome> {
  let res: Response;
  try {
    res = await fetch(new URL("/api/ingest/transcripts", server), {
      method: "POST",
      headers: { ...headers(token), "content-encoding": "gzip" },
      body: gzipSync(JSON.stringify(batch)),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, retryable: true, status: 0, error: "network", message: describeNetworkError(e) };
  }
  if (!res.ok) return failure(res);
  const parsed = ingestResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, retryable: true, status: res.status, error: "bad_response", message: "Unexpected server response" };
  return { ok: true, res: parsed.data };
}

async function call<T extends z.ZodType>(
  server: string,
  pathname: string,
  init: { method: string; token?: string; body?: unknown },
  schema: T,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(new URL(pathname, server), {
      method: init.method,
      headers: headers(init.token),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`Cannot reach ${server}: ${describeNetworkError(e)}`);
  }
  if (!res.ok) {
    const f = await failure(res);
    throw Object.assign(new Error(f.message || f.error), { code: f.error, status: f.status });
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error(`Unexpected response from ${pathname}`);
  return parsed.data;
}

export const api = {
  enroll: (server: string, body: { code: string; name: string; os: string; configDir: string | null; accountEmailProof: string | null }) =>
    call(server, "/api/cli/enroll", { method: "POST", body }, enrollResponse),
  deviceStart: (server: string, body: { name: string; os: string; accountEmailProof: string | null }) =>
    call(server, "/api/cli/device/start", { method: "POST", body }, deviceStartResponse),
  devicePoll: (server: string, deviceCode: string) =>
    call(server, "/api/cli/device/poll", { method: "POST", body: { deviceCode } }, devicePollResponse),
  whoami: (server: string, token: string) => call(server, "/api/cli/whoami", { method: "GET", token }, whoamiResponse),
  revoke: async (server: string, token: string): Promise<void> => {
    await fetch(new URL("/api/cli/device", server), {
      method: "DELETE",
      headers: headers(token),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  },
};
