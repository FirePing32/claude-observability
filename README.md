# Claude Observability

See where a Claude subscription's usage goes: sessions, models, projects, 5-hour limit blocks and the
API-equivalent value of every token, across every machine that shares the account.

```
packages/shared   wire schema (zod) + price book, shared by collector and server
packages/cli      claude-obs: reads ~/.claude transcripts, uploads usage-only records
apps/web          Next.js dashboard + ingest API (Better Auth / Google, Drizzle / Postgres)
```

Plan and design notes: [PLAN.md](PLAN.md) · collector spec: [docs/claude-obs.md](docs/claude-obs.md)

## How data flows

Nothing is pulled from Anthropic (Max/Pro accounts have no usage API). Each machine **pushes**:

1. `claude-obs` reads `~/.claude/projects/**/*.jsonl` (Claude Code CLI + desktop app), keeps only
   ids, timestamps, model, token counts and a few labels, and uploads them to `/api/ingest/transcripts`.
2. Optionally, Claude Code's own OpenTelemetry posts `api_request` events to `/api/otlp/v1/logs`.
   This adds latency and the ~5-10% of side requests (titles, classifiers) that transcripts never record.
3. The server de-duplicates by request id across machines and sources, prices each request from the
   price book, and the dashboard reads Postgres.

Prompts, responses, code, tool input/output, full paths and Claude credentials never leave a machine.

## Local development

Needs Node 20+ and Postgres 15+.

```bash
npm install
cp apps/web/.env.example apps/web/.env.local     # fill BETTER_AUTH_SECRET, CRON_SECRET; DEV_PASSWORD_LOGIN=1 for local sign-in
npm run db:migrate -w @claude-obs/web
npm run dev                                       # http://localhost:3100
```

Sign in (Google, or the dev password form when `DEV_PASSWORD_LOGIN=1`), create a workspace, open
**Connect machines**, create an enrollment code, then on the machine:

```bash
npm run build -w claude-obs
node packages/cli/dist/index.js login --code XXXX-XXXX --server http://localhost:3100
node packages/cli/dist/index.js sync
```

Tests: `npm test` (collector parser/dedup/privacy, pricing, blocks, merge rules, OTLP decoding).

## Deploying to Vercel

1. **Database**: add Neon Postgres from the Vercel Marketplace (sets `DATABASE_URL`; use the pooled URL).
2. **Project**: import the repo, set *Root Directory* to `apps/web`. `vercel-build` runs migrations, then `next build`.
3. **Google OAuth**: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web).
   Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`. Scopes needed: `openid email profile`
   (non-sensitive). Publish the consent screen with your privacy policy and terms URLs.
   Use a separate OAuth client for preview deployments.
4. **Environment variables** (Production):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled connection string |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://<your-domain>` |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 3 |
   | `CRON_SECRET` | random string (Vercel Cron sends it automatically) |
   | `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | optional, for e-mail alerts |
   | `ANTHROPIC_API_KEY` | optional, for the weekly AI digest |

   Never set `DEV_PASSWORD_LOGIN` in production (it is ignored there anyway).
5. **Cron** (`apps/web/vercel.json`): alerts every 15 min, digest Mondays 08:00 UTC, retention daily.
   Sub-daily cron needs a Vercel Pro plan.
6. **Collector**: publish `packages/cli` to npm (`npm publish --provenance` from CI), and set
   `CLAUDE_OBS_SERVER` default in `packages/cli/src/api.ts` to your domain.

## Accuracy notes

- Transcript totals were verified against an independent script on real data (1,924 requests,
  $235.27 vs $235.18 at the time; the difference was one live request).
- Claude Code repeats `usage` on every content-block line and grows `output_tokens` while streaming; the
  collector keeps one row per request id with the largest output, and the server upserts with `GREATEST()`.
- Subscription limits are not published; the 5-hour blocks and "learned limit" are a model built from
  this account's own history and limit hits. claude.ai chat usage shares the limits but is invisible.
