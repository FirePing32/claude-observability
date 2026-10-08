# claude-obs

Collector for **Claude Observability**: reads Claude Code's local session files (`~/.claude/projects`) and
uploads **usage numbers only** to your Claude Observability dashboard. It covers the CLI and the desktop app.

> Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

## Install and connect

1. Install the collector:
   ```bash
   npm install -g claude-obs
   ```
2. Get an enrollment code from your dashboard (Connect machines), then link this machine:
   ```bash
   claude-obs login --code XXXX-XXXX --server https://your-dashboard.example.com
   ```
3. Upload all history:
   ```bash
   claude-obs sync
   ```
4. Keep it live in the background:
   ```bash
   claude-obs install-agent
   ```
5. Optional, for exact totals: also send Claude Code's own telemetry, which includes side requests the session
   files don't record.
   ```bash
   claude-obs otel --install
   ```

Requires Node.js 20 or later.

## What it sends

**Sent:** request ids, timestamps, model names, token counts, effort/speed, subagent, skill and plugin names, the
project folder's name (or a hash, with `claude-obs config hash-projects on`), the git branch, session titles
(turn off with `claude-obs config titles off`), error categories, and usage-limit hits.

**Never sent:** prompts, responses, code, file contents, tool input or output, full paths, e-mail addresses, or
your Claude login.

Check before uploading anything:

```bash
claude-obs sync --dry-run
```

## Commands

```
claude-obs login [--code XXXX-XXXX] [--name "Studio Mac"] [--server URL]
claude-obs sync [--watch] [--dry-run [--all] [--json]] [--verbose]
claude-obs status
claude-obs install-agent [--print] | uninstall-agent
claude-obs otel --print | --install [--force] | --uninstall
claude-obs config [titles on|off] [hash-projects on|off]
claude-obs config-dirs [list | add <path> | remove <path>]
claude-obs show-last-upload
claude-obs resync
claude-obs doctor
claude-obs logout
```

Local state lives in `~/.config/claude-obs` (override with `CLAUDE_OBS_HOME`).

## License

MIT
