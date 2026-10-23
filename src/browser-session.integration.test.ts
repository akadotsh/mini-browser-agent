import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { BrowserSession } from "./browser-session";

const integration = process.env.MINI_BROWSER_INTEGRATION === "1" ? describe : describe.skip;
let server: ReturnType<typeof Bun.serve>;
let browser: BrowserSession;
const screenshotPaths: string[] = [];

async function waitForUrl(suffix: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browser.status().url.endsWith(suffix)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for URL ending in ${suffix}`);
}

integration("Bun.WebView integration", () => {
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response(`<!doctype html><title>Fixture</title><main style="height:2000px"><h1>Browser fixture</h1><label>Search <input aria-label="Search"></label><input type="password" value="secret"><button onclick="document.querySelector('h1').textContent='Clicked'">Go</button><a href="/next">Next</a></main><script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<p class="delayed">Ready later</p>'), 150)</script>`, { headers: { "content-type": "text/html" } }),
    });
    const backend = process.env.WEBVIEW_BACKEND === "chrome" || process.platform !== "darwin" ? "chrome" : "webkit";
    browser = new BrowserSession(10_000, () => new Bun.WebView({ backend }));
  });

  afterAll(async () => {
    browser?.close();
    server?.stop(true);
    await Promise.all(screenshotPaths.map(path => rm(path, { force: true })));
  });

  test("navigates, snapshots, interacts, extracts, and screenshots", async () => {
    await browser.navigate(server.url.href);
    const snapshot = await browser.snapshot();
    expect(snapshot.title).toBe("Fixture");
    expect(snapshot.text).toContain("Browser fixture");
    expect(snapshot.elements.some(element => element.name === "Search")).toBe(true);
    expect(snapshot.elements.some(element => element.value === "secret")).toBe(false);

    const input = snapshot.elements.find(element => element.name === "Search")!;
    await browser.type(input.ref, "bun webview");
    await browser.press("End");
    await browser.scroll(250);

    const updated = await browser.snapshot();
    expect(updated.elements.find(element => element.name === "Search")?.value).toBe("bun webview");
    const button = updated.elements.find(element => element.role === "button")!;
    const next = updated.elements.find(element => element.role === "link")!;
    await browser.click(button.ref);
    expect(await browser.extractText("css:h1")).toBe("Clicked");
    expect(await browser.extractText("css:.delayed")).toBe("Ready later");
    expect(await browser.extractLinks()).toEqual([{ text: "Next", href: new URL("/next", server.url).href }]);

    const result = await browser.screenshot(`integration-${Date.now()}.png`);
    screenshotPaths.push(result.path);
    expect(result.path).toContain("Mini Browser Agent/Screenshots/integration-");
    expect((await Bun.file(result.path).arrayBuffer()).byteLength).toBeGreaterThan(0);

    const jpeg = await browser.screenshot(`integration-${Date.now()}.jpg`);
    screenshotPaths.push(jpeg.path);
    expect(jpeg.format).toBe("jpeg");
    expect(new Uint8Array(await Bun.file(jpeg.path).arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));

    const webp = await browser.screenshot(`integration-${Date.now()}.webp`);
    screenshotPaths.push(webp.path);
    expect(webp.format).toBe("webp");
    expect(await Bun.file(webp.path).text()).toStartWith("RIFF");

    await browser.click(next.ref);
    await waitForUrl("/next");
    await browser.back();
    await waitForUrl("/");
    await browser.forward();
    await waitForUrl("/next");
    await browser.reload();
  }, 30_000);
});
