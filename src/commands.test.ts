import { describe, expect, test } from "bun:test";
import { normalizeUrl, parseInstruction, parseTarget, resolveScreenshotPath, screenshotDirectory, splitFirst } from "./commands";

describe("command helpers", () => {
  test("keeps complete command values", () => {
    expect(parseInstruction("  TYPE e2 hello world  ")).toEqual({ action: "type", value: "e2 hello world" });
    expect(splitFirst("e2 hello world")).toEqual(["e2", "hello world"]);
  });

  test("adds https and rejects non-web protocols", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow("Only http(s)");
  });

  test("parses refs and explicit CSS selectors", () => {
    expect(parseTarget("e12")).toEqual({ kind: "ref", value: "e12" });
    expect(parseTarget("css:button.primary")).toEqual({ kind: "css", value: "button.primary" });
    expect(() => parseTarget("button.primary")).toThrow("Target must be");
  });

  test("keeps screenshots inside the user's screenshot directory", () => {
    expect(screenshotDirectory("/Users/test")).toBe("/Users/test/Mini Browser Agent/Screenshots");
    expect(resolveScreenshotPath("shots/page.png", "/screenshots")).toEqual({ absolute: "/screenshots/shots/page.png", relative: "shots/page.png", format: "png" });
    expect(resolveScreenshotPath("page.jpg", "/screenshots").format).toBe("jpeg");
    expect(resolveScreenshotPath("page.jpeg", "/screenshots").format).toBe("jpeg");
    expect(resolveScreenshotPath("page.webp", "/screenshots").format).toBe("webp");
    expect(() => resolveScreenshotPath("page.gif", "/screenshots")).toThrow(".png, .jpg, .jpeg, or .webp");
    expect(() => resolveScreenshotPath("../secret.png", "/screenshots")).toThrow("inside the screenshot directory");
    expect(() => resolveScreenshotPath("/tmp/page.png", "/screenshots")).toThrow("must be relative");
  });
});
