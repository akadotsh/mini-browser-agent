# Mini Browser Agent

A lightweight AI browser automation CLI built on Bun's experimental `Bun.WebView` API. It accepts natural-language tasks, connects to any OpenAI-compatible chat-completions endpoint, and runs local browser tools through a capped agent loop.

## Requirements

- Bun 1.4 or newer with `Bun.WebView`
- macOS, or Chrome/Chromium/Edge/Brave on Linux and Windows
- An OpenAI-compatible model with tool-calling support, such as a suitable Ollama model

Check your runtime:

```sh
bun --version
bun -e 'console.log(typeof Bun.WebView)'
```

## Configure the AI provider

Configuration uses the runtime's built-in terminal support, with masked secret input and no dedicated CLI dependency. Configure a local Ollama instance like this:

```sh
bun start -- config set base-url http://localhost:11434/v1
bun start -- config set model qwen3:8b
bun start -- config set max-steps 15
```

Ollama running locally does not require an API key. For Ollama Cloud or another compatible provider, enter the key through a masked prompt rather than passing it as a command-line argument:

```sh
bun start -- config set base-url https://ollama.com/v1
bun start -- config set model gpt-oss:120b
bun start -- config set api-key
```

Run a natural-language task:

```sh
bun start -- run "Open example.com, tell me its heading, and save a screenshot"
```

Inspect or remove settings without exposing the API key:

```sh
bun start -- config show
bun start -- config unset api-key
```

Configuration is stored in the operating system's user configuration directory, outside the project:

- macOS: `~/Library/Application Support/Mini Browser Agent/config.json`
- Linux: `$XDG_CONFIG_HOME/mini-browser-agent/config.json`, or `~/.config/mini-browser-agent/config.json`
- Windows: `%APPDATA%/Mini Browser Agent/config.json`

The directory and file are created with user-only permissions where supported. `config show` reports only whether an API key is configured; it never prints the value. Environment variables remain supported and take precedence over stored settings: `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_MAX_STEPS`, with `OPENAI_API_KEY` as an API-key fallback.

Available configuration commands:

```sh
bun start -- config show
bun start -- config set <base-url|model|max-steps> [value]
bun start -- config set api-key
bun start -- config unset <base-url|model|api-key|max-steps>
```

## Deterministic browser mode

Use the underlying browser tools without an AI model:

```sh
bun start -- browser
```

Example workflow:

```text
open example.com
snapshot
click e1
text
screenshot example.png
quit
```

The process keeps one ephemeral, headless browser session alive. A snapshot assigns temporary references such as `e1` to visible controls. Run `snapshot` again after navigation or when the page changes.

## Agent behavior

- The agent can open pages, inspect compact snapshots, click, type, press keys, scroll, extract text and links, navigate history, and save screenshots.
- Browser tools execute sequentially because Bun WebView operations cannot safely overlap.
- The loop stops after `AI_MAX_STEPS` (15 by default, maximum 50).
- Clicks, typing, and key presses require terminal confirmation. Non-interactive runs deny those actions.
- Action logs never include typed text or API keys.

## Commands

| Command | Purpose |
| --- | --- |
| `open <url>` | Open an HTTP or HTTPS page |
| `snapshot` | Return compact page text and up to 100 visible interactive elements |
| `click <ref>` | Click an element from the latest snapshot |
| `click css:<selector>` | Click an explicit CSS selector |
| `type <ref> <text>` | Focus a referenced field and type text |
| `press <key>` | Press a supported named key or one character |
| `scroll <pixels>` | Scroll down or, with a negative number, up |
| `text [css:<selector>]` | Extract page or element text |
| `links` | Extract up to 100 visible links |
| `screenshot [path]` | Save a PNG, JPEG, or WebP viewport image under `~/Mini Browser Agent/Screenshots` |
| `back`, `forward`, `reload`, `url` | Use history or inspect session state |
| `help`, `quit` | Show help or close the browser |

Screenshots are stored outside the project in `~/Mini Browser Agent/Screenshots`. The folder is created automatically, and supplied paths must remain relative to it. The extension selects `.png`, `.jpg`/`.jpeg`, or `.webp`; PNG is the default and JPEG/WebP use quality 90. On WebKit, WebP is transparently converted with Bun's built-in image API. Password values are never included in snapshots. Browser operations time out after 15 seconds; a timed-out browser is recreated and must be navigated again.

## Tests

```sh
bun test
bun run typecheck
bun run build
```

The fast suite uses a fake WebView so it is reliable in CI. The integration test serves a local fixture and exercises the real native backend:

```sh
MINI_BROWSER_INTEGRATION=1 bun test src/browser-session.integration.test.ts
WEBVIEW_BACKEND=chrome MINI_BROWSER_INTEGRATION=1 bun test src/browser-session.integration.test.ts
```

On macOS, the first command uses WebKit; elsewhere it uses Chrome. The second command explicitly checks Chrome. No public internet connection is required.

## Current limitations

- `Bun.WebView` is experimental and headless-only.
- Bun 1.4's native Chrome history methods can hang, so this milestone uses page history with navigation-callback waiting.
- Snapshots and screenshots are capped to compact output and the visible viewport respectively.
- WebKit does not expose Chrome DevTools Protocol features.
- Sessions, cookies, and storage are intentionally ephemeral.
- Model tool-calling quality varies; models without tool support cannot operate the browser.
