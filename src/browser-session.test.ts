import { describe, expect, test } from "bun:test";
import { BrowserActionError, BrowserSession, type PageSnapshot } from "./browser-session";

class FakeView {
  url = "";
  title = "";
  loading = false;
  onNavigated: ((url: string, title: string) => void) | null = null;
  closed = false;
  clicked: unknown[] = [];
  scrolledTo = "";
  typed = "";
  screenshotOptions: unknown;
  clickError?: Error;
  elementChecks = 0;
  elementAfterChecks = 0;
  snapshot: PageSnapshot = { url: "https://example.test/", title: "Fixture", text: "Welcome", elements: [{ ref: "e1", role: "textbox", name: "Search" }] };

  async navigate(url: string) { this.url = url; this.title = "Fixture"; this.onNavigated?.(url, this.title); }
  async evaluate(script: string) {
    if (script.includes("rect.left +")) return { x: 10, y: 20 };
    if (script.startsWith("Boolean(document.querySelector")) return ++this.elementChecks > this.elementAfterChecks;
    if (script.includes("innerText || el.textContent")) return "Ready";
    return this.snapshot;
  }
  async scrollTo(selector: string) { this.scrolledTo = selector; }
  async click(...args: unknown[]) { if (this.clickError) throw this.clickError; this.clicked = args; }
  async type(text: string) { this.typed = text; }
  async press() {}
  async scroll() {}
  async screenshot(options?: unknown) { this.screenshotOptions = options; return new Blob(["image"]); }
  async goBack() {}
  async goForward() {}
  async reload() { this.onNavigated?.(this.url, this.title); }
  close() { this.closed = true; }
}

const sessionWith = (view: FakeView, timeout = 100) => new BrowserSession(timeout, () => view as never);

describe("BrowserSession", () => {
  test("uses snapshot refs for interaction", async () => {
    const view = new FakeView();
    const session = sessionWith(view);
    expect(await session.snapshot()).toEqual(view.snapshot);
    await session.type("e1", "bun webview");
    expect(view.scrolledTo).toBe('[data-mini-browser-ref="e1"]');
    expect(view.clicked).toEqual([10, 20]);
    expect(view.typed).toBe("bun webview");
    session.close();
  });

  test("invalidates refs after navigation", async () => {
    const session = sessionWith(new FakeView());
    await session.snapshot();
    await session.navigate("example.com");
    expect(session.click("e1")).rejects.toThrow("Unknown or stale element ref");
    session.close();
  });

  test("rejects unsupported keys", async () => {
    const session = sessionWith(new FakeView());
    expect(session.press("F13")).rejects.toThrow("Unsupported key");
    session.close();
  });

  test("waits for selector text and reports a clear timeout", async () => {
    const delayed = new FakeView();
    delayed.elementAfterChecks = 2;
    const session = new BrowserSession(500, () => delayed as never, 200);
    expect(await session.extractText("css:.late")).toBe("Ready");
    expect(delayed.elementChecks).toBe(3);
    session.close();

    const missing = new FakeView();
    missing.elementAfterChecks = Number.POSITIVE_INFINITY;
    const timed = new BrowserSession(500, () => missing as never, 5);
    expect(timed.extractText("css:.missing")).rejects.toThrow("Element css:.missing was not found within 5ms");
    timed.close();
  });

  test("reports actionable element timeouts without resetting the session", async () => {
    const view = new FakeView();
    view.clickError = new Error("timeout waiting for selector to be actionable");
    const session = new BrowserSession(500, () => view as never, 25);
    try {
      await session.click("css:.late");
      throw new Error("Expected click to time out");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserActionError);
      expect((error as BrowserActionError).message).toBe("Element css:.late was not actionable within 25ms");
      expect((error as BrowserActionError).sessionReset).toBe(false);
    }
    expect(view.closed).toBe(false);
    session.close();
  });

  test("resets the browser after a timeout", async () => {
    const views: FakeView[] = [];
    const session = new BrowserSession(5, () => {
      const view = new FakeView();
      view.navigate = async () => await new Promise<void>(() => {});
      views.push(view);
      return view as never;
    });

    try {
      await session.navigate("example.com");
      throw new Error("Expected navigation to time out");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserActionError);
      expect((error as BrowserActionError).sessionReset).toBe(true);
    }
    expect(views).toHaveLength(2);
    expect(views[0].closed).toBe(true);
    session.close();
  });
});
