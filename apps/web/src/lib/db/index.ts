import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/claude_obs";

// Reuse one pool per server instance (and across dev hot reloads).
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
// prepare:false keeps it compatible with Neon's pooled (PgBouncer) endpoint.
const client = g.__pg ?? postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
if (process.env.NODE_ENV !== "production") g.__pg = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema };
