# Mini Browser Agent

> **Experimental:** This project uses Bun's experimental `Bun.WebView` API.

A lightweight browser automation CLI built on Bun's experimental `Bun.WebView`. It can run browser tasks through an OpenAI-compatible model or in an interactive, deterministic mode.

## Requirements

- Bun 1.4+ with `Bun.WebView`
- macOS, or Chrome/Chromium/Edge/Brave on Linux and Windows
- A tool-calling model for AI mode

## Setup

Configure a provider (local Ollama shown):

```sh
bun start -- config set base-url http://localhost:11434/v1
bun start -- config set model qwen3:8b
```

Then run a task:

```sh
bun start -- run "Open example.com, tell me its heading, and save a screenshot"
```

To run in a visible Chrome window, add `--headed`:

```sh
bun start -- run --headed "Open example.com and tell me its heading"
bun start -- browser --headed
```

Headed mode connects to the Chrome window you already have open. Install this repository's `chrome-extension` folder once in that Chrome profile through `chrome://extensions` → **Developer mode** → **Load unpacked**. After extension code changes, click its **Reload** button there. With Chrome open and the extension enabled, `--headed` creates an **Agent** tab in the current window and uses that browser session, including its signed-in sites. The extension groups agent tabs under **Agent**. Chrome will show its debugger permission notice while the agent controls a tab, and may ask to allow its local connection.

For hosted providers, set the base URL and model, then run `bun start -- config set api-key` to enter the key through a masked prompt. Settings are stored in the OS user config directory. Environment variables (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_MAX_STEPS`) override stored values; `OPENAI_API_KEY` is also accepted.

Use `bun start -- config show` to inspect configuration or `bun start -- config unset <key>` to remove a setting. More runnable scripts are in [examples](examples/).

## Browser mode

Run `bun start -- browser` to use the browser without an AI model. Available commands:

```text
open <url>                 snapshot
click <ref|css:selector>  type <ref> <text>
press <key>               scroll <pixels>
text [css:selector]       links
network [clear]           show recent network log entries (headed Chrome)
evaluate <expression>    screenshot [path]
back | forward | reload | url | quit
```

`evaluate` runs a JavaScript expression in the page and returns its result. In AI mode, it requires terminal confirmation because it can change page state. Clicks, typing, and key presses also require confirmation. Screenshots are saved under `~/Mini Browser Agent/Screenshots`.

Headed Chrome mode captures up to 500 Agent tab network events. The `networkLogs` agent tool and `network` browser command show request URLs and methods, response status and MIME type, and failures; they do not capture headers or response bodies.

## Notes

- Browser operations run sequentially. The agent stops after 15 steps by default; configure `AI_MAX_STEPS` up to 50.
- Snapshots omit password values. Headless browser sessions, cookies, and storage are ephemeral.
- `Bun.WebView` is experimental and headless-only; WebKit does not expose Chrome DevTools Protocol features.

Run the test suite and checks with `bun test`, `bun run typecheck`, and `bun run build`. The real-browser integration test can be enabled with `MINI_BROWSER_INTEGRATION=1`.
