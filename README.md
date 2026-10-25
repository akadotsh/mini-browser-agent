# Mini Browser Agent

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

For hosted providers, set the base URL and model, then run `bun start -- config set api-key` to enter the key through a masked prompt. Settings are stored in the OS user config directory. Environment variables (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_MAX_STEPS`) override stored values; `OPENAI_API_KEY` is also accepted.

Use `bun start -- config show` to inspect configuration or `bun start -- config unset <key>` to remove a setting. More runnable scripts are in [examples](examples/).

## Browser mode

Run `bun start -- browser` to use the browser without an AI model. Available commands:

```text
open <url>                 snapshot
click <ref|css:selector>  type <ref> <text>
press <key>               scroll <pixels>
text [css:selector]       links
evaluate <expression>    screenshot [path]
back | forward | reload | url | quit
```

`evaluate` runs a JavaScript expression in the page and returns its result. In AI mode, it requires terminal confirmation because it can change page state. Clicks, typing, and key presses also require confirmation. Screenshots are saved under `~/Mini Browser Agent/Screenshots`.

## Notes

- Browser operations run sequentially. The agent stops after 15 steps by default; configure `AI_MAX_STEPS` up to 50.
- Snapshots omit password values. Browser sessions, cookies, and storage are ephemeral.
- `Bun.WebView` is experimental and headless-only; WebKit does not expose Chrome DevTools Protocol features.

Run the test suite and checks with `bun test`, `bun run typecheck`, and `bun run build`. The real-browser integration test can be enabled with `MINI_BROWSER_INTEGRATION=1`.
