# claude-obs

Collector for **Claude Observability**: reads Claude Code's local session files (`~/.claude/projects`) and
uploads **usage numbers only** to your Claude Observability dashboard. It covers the CLI and the desktop app.

> Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

## Install and connect

1. Install the collector:
   ```bash
   npm install -g claude-obs
   ```
2. Get an enrollment code from your dashboard (Connect machines), then link this machine. The dashboard shows
   the exact command, including `--server <your dashboard URL>` if you need it:
   ```bash
   claude-obs login --code XXXX-XXXX
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

## Corporate networks (Netskope, Zscaler, proxies)

Networks that inspect HTTPS re-sign traffic with a company certificate. Your browser trusts it because it's in the
operating system's certificate store; Node.js normally doesn't. **claude-obs trusts the operating system's
certificates automatically**:

- On Node 22.19+ / 24.5+, it loads them in-process.
- On older Node (macOS and Linux), it uses the system bundle and relaunches itself once. On macOS the bundle is the
  System keychain plus Apple's roots, cached in `~/.config/claude-obs/system-ca.pem` and refreshed weekly.

`claude-obs doctor` shows which mode is in use. To turn this off, set `CLAUDE_OBS_SYSTEM_CA=0`.

If it still fails (for example on Windows with Node older than 22.19), use one of these:
- Node 22.15+ with `NODE_USE_SYSTEM_CA=1` in your shell profile.
- Export the company root certificate and point Node at it. On macOS, replace `<issuer>` with part of the
  certificate's name, for example `goskope.com` for Netskope:
  ```bash
  mkdir -p ~/.certs && security find-certificate -a -p -c "<issuer>" /Library/Keychains/System.keychain > ~/.certs/corp-ca.pem
  ```
  ```bash
  echo 'export NODE_EXTRA_CA_CERTS="$HOME/.certs/corp-ca.pem"' >> ~/.zshrc
  ```

`install-agent` copies `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA` and `HTTPS_PROXY`/`NO_PROXY` into the background
service, because services don't read your shell profile.

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
