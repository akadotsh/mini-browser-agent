import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeUrl, parseTarget, resolveScreenshotPath } from "./commands";

type WebView = InstanceType<typeof Bun.WebView>;
type WebViewFactory = () => WebView;

export type PageElement = { ref: string; role: string; name: string; value?: string; href?: string };
export type PageSnapshot = { url: string; title: string; text: string; elements: PageElement[] };
export type BrowserResult = { action: string; message: string; url: string; title: string };
export type LinkResult = { text: string; href: string };

export class BrowserActionError extends Error {
  constructor(message: string, public readonly sessionReset = false) {
    super(message);
    this.name = "BrowserActionError";
  }
}

const SNAPSHOT_SCRIPT = `(() => {
  document.querySelectorAll("[data-mini-browser-ref]").forEach(el => el.removeAttribute("data-mini-browser-ref"));
  const visible = el => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const role = el => {
    if (el.getAttribute("role")) return el.getAttribute("role");
    if (el.tagName === "INPUT") return ({ checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", reset: "button" }[el.type] || "textbox");
    return ({ A: "link", BUTTON: "button", TEXTAREA: "textbox", SELECT: "combobox" }[el.tagName] || el.tagName.toLowerCase());
  };
  const name = el => {
    const labelledBy = el.getAttribute("aria-labelledby");
    return (el.getAttribute("aria-label") || (labelledBy && document.getElementById(labelledBy)?.innerText) || el.alt || el.placeholder || el.innerText || el.title || el.name || "").trim().replace(/\\s+/g, " ").slice(0, 160);
  };
  const elements = [...document.querySelectorAll("a[href],button,input,textarea,select,[role],[tabindex]")]
    .filter(visible).slice(0, 100).map((el, index) => {
      const ref = "e" + (index + 1);
      el.setAttribute("data-mini-browser-ref", ref);
      const item = { ref, role: role(el), name: name(el) };
      if (el.href) item.href = el.href;
      if ("value" in el && el.type !== "password" && el.value) item.value = String(el.value).slice(0, 160);
      return item;
    });
  return { url: location.href, title: document.title, text: (document.body?.innerText || "").trim().replace(/\\n{3,}/g, "\\n\\n").slice(0, 6000), elements };
})()`;

const LINKS_SCRIPT = `[...document.querySelectorAll("a[href]")].filter(a => { const r = a.getBoundingClientRect(); const s = getComputedStyle(a); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; }).slice(0, 100).map(a => ({ text: a.innerText.trim().replace(/\\s+/g, " ").slice(0, 160), href: a.href }))`;
const KEYS = new Set(["Enter", "Tab", "Space", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export class BrowserSession {
  private view: WebView;
  private refs = new Set<string>();
  private navigationCount = 0;

  constructor(
    private readonly timeoutMs = 15_000,
    private readonly createView: WebViewFactory = () => new Bun.WebView({ width: 1280, height: 800 }),
    private readonly elementTimeoutMs = 5_000,
  ) {
    this.view = this.newView();
  }

  private newView() {
    const view = this.createView();
    view.onNavigated = () => {
      this.refs.clear();
      this.navigationCount++;
    };
    return view;
  }

  private async waitForNavigation(start: number) {
    for (let attempt = 0; attempt < 25 && this.navigationCount === start; attempt++) await Bun.sleep(20);
  }

  private async run<T>(action: string, operation: (view: WebView) => Promise<T>): Promise<T> {
    const view = this.view;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        view.close();
        this.refs.clear();
        this.view = this.newView();
        reject(new BrowserActionError(`${action} timed out after ${this.timeoutMs}ms; browser session was reset`, true));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve().then(() => operation(view)), timeout]);
    } catch (error) {
      if (error instanceof BrowserActionError) throw error;
      throw new BrowserActionError(`${action} failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      clearTimeout(timer!);
    }
  }

  private selector(target: string): string {
    const parsed = parseTarget(target);
    if (parsed.kind === "css") return parsed.value;
    if (!this.refs.has(parsed.value)) throw new BrowserActionError(`Unknown or stale element ref: ${parsed.value}. Run snapshot again.`);
    return `[data-mini-browser-ref="${parsed.value}"]`;
  }

  private async clickSelector(view: WebView, selector: string, target: string) {
    try {
      await view.scrollTo(selector, { timeout: this.elementTimeoutMs });
      const point = await view.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Element not found"); const rect = el.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`) as { x: number; y: number };
      await view.click(point.x, point.y);
    } catch (error) {
      if (/timeout|not found|actionable/i.test(String(error))) {
        throw new BrowserActionError(`Element ${target} was not actionable within ${this.elementTimeoutMs}ms`);
      }
      throw error;
    }
  }

  private async waitForElement(view: WebView, selector: string, target: string) {
    const deadline = Date.now() + this.elementTimeoutMs;
    while (Date.now() < deadline) {
      const found = await view.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return;
      await Bun.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    throw new BrowserActionError(`Element ${target} was not found within ${this.elementTimeoutMs}ms`);
  }

  private result(action: string, message: string): BrowserResult {
    return { action, message, url: this.view.url, title: this.view.title };
  }

  async navigate(url: string) {
    const normalized = normalizeUrl(url);
    await this.run(`open ${normalized}`, view => view.navigate(normalized));
    return this.result("open", `Loaded ${this.view.title || normalized}`);
  }

  async snapshot(): Promise<PageSnapshot> {
    const snapshot = await this.run("snapshot", view => view.evaluate(SNAPSHOT_SCRIPT)) as PageSnapshot;
    this.refs = new Set(snapshot.elements.map(element => element.ref));
    return snapshot;
  }

  async click(target: string) {
    const selector = this.selector(target);
    await this.run(`click ${target}`, view => this.clickSelector(view, selector, target));
    return this.result("click", `Clicked ${target}`);
  }

  async type(ref: string, text: string) {
    const selector = this.selector(ref);
    await this.run(`type ${ref}`, async view => {
      await this.clickSelector(view, selector, ref);
      await view.type(text);
    });
    return this.result("type", `Typed into ${ref}`);
  }

  async press(key: string) {
    if (!KEYS.has(key) && [...key].length !== 1) throw new BrowserActionError(`Unsupported key: ${key}`);
    await this.run(`press ${key}`, view => view.press(key as Parameters<WebView["press"]>[0]));
    return this.result("press", `Pressed ${key}`);
  }

  async scroll(pixels: number) {
    if (!Number.isFinite(pixels)) throw new BrowserActionError("Scroll distance must be a finite number");
    await this.run(`scroll ${pixels}`, view => view.scroll(0, pixels));
    return this.result("scroll", `Scrolled ${pixels}px`);
  }

  async extractText(selector?: string): Promise<string> {
    const target = selector ? parseTarget(selector) : { kind: "css" as const, value: "body" };
    if (target.kind !== "css") throw new BrowserActionError('Text target must start with "css:"');
    const script = `(() => { const el = document.querySelector(${JSON.stringify(target.value)}); if (!el) throw new Error("Element not found"); return (el.innerText || el.textContent || "").trim().slice(0, 10000); })()`;
    return await this.run("text", async view => {
      await this.waitForElement(view, target.value, selector || "body");
      return await view.evaluate(script);
    }) as string;
  }

  async extractLinks(): Promise<LinkResult[]> {
    return await this.run("links", view => view.evaluate(LINKS_SCRIPT)) as LinkResult[];
  }

  async evaluate(script: string): Promise<unknown> {
    if (!script.trim()) throw new BrowserActionError("JavaScript expression cannot be empty");
    return await this.run("evaluate JavaScript", view => view.evaluate(script));
  }

  async screenshot(path = "") {
    const output = resolveScreenshotPath(path);
    try {
      await mkdir(dirname(output.absolute), { recursive: true });
      const options = output.format === "png" ? { format: "png" as const } : { format: output.format, quality: 90 };
      const image = await this.run(`screenshot ${output.format}`, async view => {
        try {
          return await view.screenshot(options);
        } catch (error) {
          if (output.format !== "webp" || !String(error).includes('requires backend: "chrome"')) throw error;
          const png = await view.screenshot({ format: "png" });
          return await new Bun.Image(png).webp({ quality: 90 }).blob();
        }
      });
      await Bun.write(output.absolute, image);
    } catch (error) {
      if (error instanceof BrowserActionError) throw error;
      throw new BrowserActionError(`screenshot failed: ${error instanceof Error ? error.message : error}`);
    }
    return { action: "screenshot", message: `Saved ${output.format.toUpperCase()} screenshot to ${output.absolute}`, path: output.absolute, format: output.format, url: this.view.url, title: this.view.title };
  }

  async back() {
    const start = this.navigationCount;
    // shortcut: Bun 1.4 Chrome history methods can hang, retry native methods when fixed.
    await this.run("back", async view => {
      await view.evaluate("(() => { history.back(); return true })()");
      await this.waitForNavigation(start);
    });
    return this.result("back", "Went back");
  }

  async forward() {
    const start = this.navigationCount;
    await this.run("forward", async view => {
      await view.evaluate("(() => { history.forward(); return true })()");
      await this.waitForNavigation(start);
    });
    return this.result("forward", "Went forward");
  }

  async reload() {
    await this.run("reload", view => view.reload());
    return this.result("reload", "Reloaded page");
  }

  status() {
    return { url: this.view.url, title: this.view.title, loading: this.view.loading };
  }

  close() {
    this.view.close();
  }
}
