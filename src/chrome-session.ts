import { BrowserSession, type NetworkLogEntry } from "./browser-session";

const PORT = 18765;
type Socket = import("bun").ServerWebSocket<unknown>;

function startBridge() {
  let socket: Socket | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let connect!: () => void;
  const connected = new Promise<void>(resolve => { connect = resolve; });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    fetch(request, server) {
      const origin = request.headers.get("origin") || "";
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return new Response("Forbidden", { status: 403 });
      if (server.upgrade(request)) return;
      return new Response("WebSocket required", { status: 426 });
    },
    websocket: {
      open(ws) { socket = ws; },
      message(_ws, message) {
        const data = JSON.parse(String(message));
        if (data.type === "hello") { connect(); return; }
        if (data.type === "event") {
          for (const listener of listeners) listener(data);
          return;
        }
        const call = pending.get(data.id);
        if (!call) return;
        pending.delete(data.id);
        if (data.error) call.reject(new Error(data.error));
        else call.resolve(data.result);
      },
      close() {
        socket = undefined;
        for (const call of pending.values()) call.reject(new Error("Chrome extension disconnected"));
        pending.clear();
      },
    },
  });
  const listeners = new Set<(event: any) => void>();
  return {
    server,
    connected,
    listen(callback: (event: any) => void) { listeners.add(callback); return () => listeners.delete(callback); },
    call(method: string, tabId?: number, params: Record<string, unknown> = {}) {
      if (!socket) return Promise.reject(new Error("Chrome extension is disconnected"));
      const id = ++nextId;
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome ${method} timed out`)); }, 20_000);
        pending.set(id, {
          resolve(value) { clearTimeout(timer); resolve(value); },
          reject(error) { clearTimeout(timer); reject(error); },
        });
        socket!.send(JSON.stringify({ id, method, tabId, params }));
      });
    },
    close() { server.stop(true); },
  };
}

class ChromeView {
  url = "about:blank";
  title = "";
  loading = false;
  onNavigated: (() => void) | null = null;
  private tabId?: number;
  private removeListener: () => void;
  private networkLog: NetworkLogEntry[] = [];

  constructor(private readonly bridge: ReturnType<typeof startBridge>) {
    this.removeListener = bridge.listen(event => {
      if (event.tabId === this.tabId && event.method.startsWith("Network.")) {
        const params = event.params;
        const entry: NetworkLogEntry | undefined = event.method === "Network.requestWillBeSent"
          ? { event: "request", requestId: params.requestId, url: params.request.url, method: params.request.method, resourceType: params.type }
          : event.method === "Network.responseReceived"
            ? { event: "response", requestId: params.requestId, url: params.response.url, status: params.response.status, mimeType: params.response.mimeType }
            : event.method === "Network.loadingFailed"
              ? { event: "failed", requestId: params.requestId, errorText: params.errorText }
              : event.method === "Network.loadingFinished"
                ? { event: "finished", requestId: params.requestId, encodedDataLength: params.encodedDataLength }
                : undefined;
        if (entry) {
          this.networkLog.push(entry);
          // shortcut: cap metadata-only history at 500 events; add HAR/body storage if full traces are needed.
          if (this.networkLog.length > 500) this.networkLog.shift();
        }
      }
      if (event.tabId !== this.tabId || event.method !== "Page.frameNavigated" || event.params.frame.parentId) return;
      this.url = event.params.frame.url;
      this.onNavigated?.();
    });
  }

  getNetworkLogs(clear = false) {
    const entries = this.networkLog.slice();
    if (clear) this.networkLog = [];
    return entries;
  }

  private async ensureTab() {
    if (this.tabId !== undefined) return;
    const opened = await this.bridge.call("open");
    this.tabId = opened.tabId;
    this.url = opened.url;
    this.title = opened.title;
    this.onNavigated?.();
  }

  private async evaluate(script: string) {
    await this.ensureTab();
    return this.bridge.call("evaluate", this.tabId, { expression: script });
  }

  async navigate(url: string) {
    this.loading = true;
    try {
      await this.ensureTab();
      const page = await this.bridge.call("navigate", this.tabId, { url });
      this.url = page.url;
      this.title = page.title;
    } finally { this.loading = false; }
  }

  async scrollTo(selector: string) { await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"center"})`); }
  async click(x: number, y: number) { await this.ensureTab(); await this.bridge.call("click", this.tabId, { x, y }); }
  async type(text: string) { await this.ensureTab(); await this.bridge.call("type", this.tabId, { text }); }
  async press(key: string) { await this.ensureTab(); await this.bridge.call("press", this.tabId, { key }); }
  async scroll(x: number, y: number) { await this.ensureTab(); await this.bridge.call("scroll", this.tabId, { x, y }); }
  async screenshot(options: { format: "png" | "jpeg" | "webp"; quality?: number }) {
    await this.ensureTab();
    const data = await this.bridge.call("screenshot", this.tabId, options);
    return Buffer.from(data, "base64");
  }
  async reload() {
    await this.ensureTab();
    await this.bridge.call("reload", this.tabId);
    const page = await this.evaluate("({url:location.href,title:document.title})");
    this.url = page.url;
    this.title = page.title;
  }
  async close() {
    this.removeListener();
    if (this.tabId !== undefined) await this.bridge.call("detach", this.tabId).catch(() => {});
  }
}

export async function createChromeBrowserSession() {
  const bridge = startBridge();
  try {
    await Promise.race([
      bridge.connected,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`No Chrome extension connected after 15 seconds. In the same Chrome profile, open chrome://extensions, enable Developer mode, then load or reload this repository's chrome-extension folder and retry (bridge port ${PORT}).`)), 15_000)),
    ]);
  } catch (error) {
    bridge.close();
    throw error;
  }
  const browser = new BrowserSession(15_000, () => new ChromeView(bridge) as never);
  return {
    browser,
    close: async () => { browser.close(); await Bun.sleep(100); bridge.close(); },
  };
}
