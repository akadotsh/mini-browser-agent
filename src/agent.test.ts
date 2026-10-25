import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { readAgentConfig, runAgent } from "./agent";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function fakeBrowser() {
  const calls: string[] = [];
  const evaluations: string[] = [];
  return {
    calls,
    evaluations,
    navigate: async (url: string) => { calls.push(`open:${url}`); return { action: "open", message: "loaded", url, title: "Test" }; },
    snapshot: async () => ({ url: "https://example.com", title: "Test", text: "Hello", elements: [] }),
    click: async (target: string) => { calls.push(`click:${target}`); return {} as never; },
    type: async () => ({} as never), press: async () => ({} as never), scroll: async () => ({} as never),
    extractText: async () => "Hello", extractLinks: async () => [], screenshot: async () => ({} as never),
    evaluate: async (script: string) => { evaluations.push(script); return script === "(6 * 7)" ? 42 : undefined; },
    back: async () => ({} as never), forward: async () => ({} as never), reload: async () => ({} as never),
  };
}

describe("agent", () => {
  test("reads Ollama-compatible defaults and validates configuration", () => {
    expect(readAgentConfig({ AI_MODEL: "qwen3:8b" })).toEqual({ baseURL: "http://localhost:11434/v1", model: "qwen3:8b", apiKey: undefined, maxSteps: 15 });
    expect(() => readAgentConfig({})).toThrow("AI_MODEL is required");
    expect(() => readAgentConfig({ AI_MODEL: "model", AI_MAX_STEPS: "0" })).toThrow("AI_MAX_STEPS");
  });

  test("executes a browser tool and returns the final summary", async () => {
    const browser = fakeBrowser();
    const model = new MockLanguageModelV4({ doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "call-1", toolName: "open", input: '{"url":"https://example.com"}' }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
      { content: [{ type: "text", text: "Opened the example page." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ] });

    const result = await runAgent({ prompt: "Open example.com", model, browser, confirm: async () => true, log: () => {} });
    expect(browser.calls).toEqual(["open:https://example.com"]);
    expect(result.text).toBe("Opened the example page.");
    expect(result.steps).toBe(2);
  });

  test("evaluates a JavaScript math expression after confirmation", async () => {
    const browser = fakeBrowser();
    const confirmations: string[] = [];
    const model = new MockLanguageModelV4({ doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "call-1", toolName: "evaluate", input: '{"script":"(6 * 7)"}' }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
      { content: [{ type: "text", text: "The result is 42." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ] });

    const result = await runAgent({
      prompt: "Evaluate 6 times 7 in the page context",
      model,
      browser,
      confirm: async message => { confirmations.push(message); return true; },
      log: () => {},
    });
    expect(browser.evaluations).toEqual(["(6 * 7)"]);
    expect(confirmations).toEqual(["Allow JavaScript execution in the current page?"]);
    expect(result.text).toBe("The result is 42.");
  });

  test("does not execute a denied sensitive action", async () => {
    const browser = fakeBrowser();
    const model = new MockLanguageModelV4({ doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "call-1", toolName: "click", input: '{"target":"e1"}' }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
      { content: [{ type: "text", text: "The click was denied." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ] });

    await runAgent({ prompt: "Click", model, browser, confirm: async () => false, log: () => {} });
    expect(browser.calls).toEqual([]);
  });
});
