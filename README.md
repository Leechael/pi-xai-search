# pi-xai-search

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Search the web and X in Pi through your xAI / Grok subscription.**

Pi keeps the harness small. xAI already exposes built-in Responses tools for web search and X (Twitter) search. This package connects the two: it registers xAI OAuth inside Pi and adds `xai_search` and `tweet_search` tools that call those server-side tools.

No API key env var for normal use. If Pi can log in to xAI, this extension can use the same credential path.

## Why this exists

Web and social search do not have to be built into Pi. They can be tools.

This extension is for Pi workflows that need fresh or source-backed information from xAI:

- **Look up current docs and the open web.** `xai_search` calls xAI Responses with built-in `web_search`.
- **Search live posts on X.** `tweet_search` calls the same API with built-in `x_search`.
- **Reuse Pi's xAI login.** The extension registers the `xai` provider OAuth flow and resolves credentials through `ctx.modelRegistry.getApiKeyForProvider("xai")`.
- **Keep credentials inside Pi.** Pi owns persistence, refresh locking, and configured auth paths. The extension never reads `auth.json` directly.
- **Optional domain and date filters.** Restrict web results to allowed domains, or bound X results with `from_date` / `to_date`.

## What this package adds

- An `xai` OAuth provider registration for `/login xai`.
- An `xai_search` Pi tool backed by Responses `tools: [{ type: "web_search" }]`.
- A `tweet_search` Pi tool backed by Responses `tools: [{ type: "x_search" }]`.
- Default models aligned with grok-build / pi-xai search paths:
  - web: `grok-4.20-multi-agent`
  - X: `grok-4.20-0309-reasoning`
- Formatted tool output with citations, server-side tool usage, and token counts when xAI returns them.
- Session affinity for `tweet_search` via Responses `prompt_cache_key` (Pi session id, never conversation text).
- No build step. Pi loads the TypeScript extension directly.

## Install

From npm:

```bash
pi install npm:pi-xai-search
```

Or load a local checkout without installing:

```bash
pi -e /path/to/pi-xai-search
```

### Install from GitHub Release tarball

If you prefer not to use npm, download the tarball from the [latest release](https://github.com/Leechael/pi-xai-search/releases/latest), extract it, and install from the local path:

```bash
curl -L https://github.com/Leechael/pi-xai-search/releases/latest/download/pi-xai-search.tar.gz | tar -xz -C /tmp
pi install /tmp/pi-xai-search
```

## Sign in

Inside Pi, run:

```text
/login xai
```

Complete the xAI device-code flow. Pi stores and refreshes the credential.

Both tools resolve the key through Pi's public provider API. If no xAI credential is available, the tool fails with a message that points back to `/login xai`.

## Tools

Default tools:

```text
xai_search
tweet_search
```

### `xai_search`

Calls `POST https://api.x.ai/v1/responses` with built-in `web_search`.

Example call:

```json
{
  "name": "xai_search",
  "arguments": {
    "query": "latest xAI Grok release notes",
    "allowed_domains": ["x.ai", "docs.x.ai"]
  }
}
```

Arguments:

- `query` — required search question.
- `allowed_domains` — optional list of domains to restrict results to.

### `tweet_search`

Calls the same Responses endpoint with built-in `x_search`.

Example call:

```json
{
  "name": "tweet_search",
  "arguments": {
    "query": "from:xai grok",
    "from_date": "2026-01-01",
    "to_date": "2026-07-01"
  }
}
```

Arguments:

- `query` — required X search query.
- `from_date` — optional `YYYY-MM-DD` (UTC), inclusive lower bound.
- `to_date` — optional `YYYY-MM-DD` (UTC), inclusive upper bound.

`tweet_search` also sends the Pi session id as Responses cache affinity. It is not injected into the model conversation text.

## Auth model

1. Extension startup registers `pi.registerProvider("xai", { oauth })`.
2. Tool execution calls `ctx.modelRegistry.getApiKeyForProvider("xai")`.
3. Pi chooses among configured credentials, refreshes OAuth when needed, and returns an access token.
4. The extension sends `Authorization: Bearer <token>` to the xAI Responses API.

The extension does not touch `authStorage` or `~/.pi/agent/auth.json` itself.

## Notes

### xAI search vs model search

This does not add browsing to the model provider itself. It adds Pi tools. The model decides when to call `xai_search` or `tweet_search`, just like any other tool.

### Protocol alignment

- `xai_search` follows the grok-build `web_search` shape (`grok-4.20-multi-agent` fallback).
- `tweet_search` follows the pi-xai `xai_x_search` shape (`grok-4.20-0309-reasoning` fallback).

## Troubleshooting

### Tool fails with missing xAI credentials

Run:

```text
/login xai
```

Complete device authorization, then retry the tool call.

### The model does not see `xai_search` or `tweet_search`

Confirm the extension is installed or loaded:

```bash
pi install npm:pi-xai-search
# or
pi -e /path/to/pi-xai-search
```

### A different extension already registers the same tool names

The tool names are fixed as `xai_search` and `tweet_search`. Disable conflicting extensions or tools with the same names.

## Development

```bash
npm install
npm run check
npm test
npm run lint
npm run format:check
```

## References

- Pi: [earendil-works/pi](https://github.com/earendil-works/pi)
- xAI API: [docs.x.ai](https://docs.x.ai)

## License

MIT
