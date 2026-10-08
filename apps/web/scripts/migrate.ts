import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Migrations need a direct (unpooled) connection; Neon's Vercel integration provides DATABASE_URL_UNPOOLED.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/claude_obs";
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await client.end();
console.log("migrations applied");
