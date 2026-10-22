import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, tool, ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import type { BrowserSession } from "./browser-session";
import type { StoredConfig } from "./config";

export type AgentConfig = { baseURL: string; model: string; apiKey?: string; maxSteps: number };
type BrowserDriver = Pick<BrowserSession, "navigate" | "snapshot" | "click" | "type" | "press" | "scroll" | "extractText" | "extractLinks" | "screenshot" | "back" | "forward" | "reload">;
type Confirm = (message: string) => Promise<boolean>;

export function readAgentConfig(env: Record<string, string | undefined> = process.env, stored: StoredConfig = {}): AgentConfig {
  const baseURL = env.AI_BASE_URL || stored.baseURL || "http://localhost:11434/v1";
  const url = new URL(baseURL);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("AI_BASE_URL must use http or https");

  const model = (env.AI_MODEL || stored.model)?.trim();
  if (!model) throw new Error("AI_MODEL is required (for example: AI_MODEL=qwen3:8b)");

  const maxSteps = Number(env.AI_MAX_STEPS || stored.maxSteps || 15);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 50) throw new Error("AI_MAX_STEPS must be an integer from 1 to 50");
  return { baseURL: url.href.replace(/\/$/, ""), model, apiKey: env.AI_API_KEY || env.OPENAI_API_KEY || stored.apiKey, maxSteps };
}

export function createCompatibleModel(config: AgentConfig) {
  return createOpenAICompatible({ name: "openai-compatible", baseURL: config.baseURL, apiKey: config.apiKey }).chatModel(config.model);
}

export function createBrowserTools(browser: BrowserDriver, confirm: Confirm, log: (message: string) => void = console.log) {
  const run = async <T>(name: string, operation: () => Promise<T>) => {
    log(`→ ${name}`);
    return await operation();
  };
  const approved = async (description: string) => {
    const allowed = await confirm(description);
    if (!allowed) return { denied: true, message: "User denied this action" };
  };

  return {
    open: tool({ description: "Open an HTTP or HTTPS URL.", inputSchema: z.object({ url: z.string().describe("Absolute URL or hostname") }), execute: ({ url }) => run(`open ${url}`, () => browser.navigate(url)) }),
    snapshot: tool({ description: "Inspect compact page text and visible interactive element refs. Use after opening or navigating.", inputSchema: z.object({}), execute: () => run("snapshot", () => browser.snapshot()) }),
    click: tool({ description: "Click an element ref from the latest snapshot, or an explicit css: selector.", inputSchema: z.object({ target: z.string() }), execute: async ({ target }) => (await approved(`Allow click on ${target}?`)) ?? run(`click ${target}`, () => browser.click(target)) }),
    type: tool({ description: "Type text into an element ref from the latest snapshot.", inputSchema: z.object({ ref: z.string(), text: z.string() }), execute: async ({ ref, text }) => (await approved(`Allow typing ${text.length} character(s) into ${ref}?`)) ?? run(`type ${ref} (${text.length} characters)`, () => browser.type(ref, text)) }),
    press: tool({ description: "Press a keyboard key such as Enter, Tab, Escape, or ArrowDown.", inputSchema: z.object({ key: z.string() }), execute: async ({ key }) => (await approved(`Allow key press ${key}?`)) ?? run(`press ${key}`, () => browser.press(key)) }),
    scroll: tool({ description: "Scroll vertically by pixels; negative values scroll up.", inputSchema: z.object({ pixels: z.number() }), execute: ({ pixels }) => run(`scroll ${pixels}`, () => browser.scroll(pixels)) }),
    text: tool({ description: "Extract page text, optionally from an explicit css: selector.", inputSchema: z.object({ selector: z.string().optional() }), execute: ({ selector }) => run(`text${selector ? ` ${selector}` : ""}`, () => browser.extractText(selector)) }),
    links: tool({ description: "Extract visible links from the current page.", inputSchema: z.object({}), execute: () => run("links", () => browser.extractLinks()) }),
    screenshot: tool({ description: "Save a viewport screenshot under the user's Mini Browser Agent/Screenshots folder. The optional relative path selects PNG, JPEG, or WebP by extension.", inputSchema: z.object({ path: z.string().optional() }), execute: ({ path }) => run(`screenshot${path ? ` ${path}` : ""}`, () => browser.screenshot(path)) }),
    back: tool({ description: "Navigate back in browser history.", inputSchema: z.object({}), execute: () => run("back", () => browser.back()) }),
    forward: tool({ description: "Navigate forward in browser history.", inputSchema: z.object({}), execute: () => run("forward", () => browser.forward()) }),
    reload: tool({ description: "Reload the current page.", inputSchema: z.object({}), execute: () => run("reload", () => browser.reload()) }),
  };
}

export async function runAgent(options: { prompt: string; model: LanguageModel; browser: BrowserDriver; confirm: Confirm; maxSteps?: number; log?: (message: string) => void }) {
  const agent = new ToolLoopAgent({
    model: options.model,
    tools: createBrowserTools(options.browser, options.confirm, options.log),
    toolCallConcurrency: 1,
    stopWhen: stepCountIs(options.maxSteps ?? 15),
    instructions: "You are a careful browser agent. Use browser tools to complete the user's task. Open a page, take a snapshot, use element refs, and re-snapshot after navigation or page changes. Never invent page contents or claim an action succeeded without its tool result. If an action is denied, do not retry it. Finish with a concise summary and requested findings.",
  });
  const result = await agent.generate({ prompt: options.prompt });
  return { text: result.text, steps: result.steps.length };
}
