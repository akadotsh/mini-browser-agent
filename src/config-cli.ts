import { createInterface } from "node:readline/promises";
import { configFilePath, loadStoredConfig, saveStoredConfig, type StoredConfig } from "./config";

type ConfigKey = "base-url" | "model" | "api-key" | "max-steps";
const keys = new Set<ConfigKey>(["base-url", "model", "api-key", "max-steps"]);

async function promptText(message: string, initialValue?: string) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = initialValue ? ` (${initialValue})` : "";
    const value = (await terminal.question(`${message}${suffix}: `)).trim();
    return value || initialValue || "";
  } finally {
    terminal.close();
  }
}

async function promptSecret(message: string) {
  const input = process.stdin;
  const output = process.stdout;
  output.write(`${message}: `);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Configuration cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
        } else if (character >= " ") {
          value += character;
          output.write("*");
        }
      }
    };
    input.on("data", onData);
  });
}

export async function runConfigCommand(args: string[], env = process.env) {
  const path = configFilePath();
  const stored = await loadStoredConfig(path);
  const [action = "show", rawKey, inlineValue] = args;

  if (action === "show") {
    console.log({
      path,
      baseURL: env.AI_BASE_URL || stored.baseURL || "http://localhost:11434/v1",
      model: env.AI_MODEL || stored.model || "not configured",
      apiKey: env.AI_API_KEY || env.OPENAI_API_KEY || stored.apiKey ? "configured" : "not configured",
      maxSteps: Number(env.AI_MAX_STEPS || stored.maxSteps || 15),
    });
    return;
  }

  if (action !== "set" && action !== "unset") throw new Error("Usage: config [show|set <key> [value]|unset <key>]");
  if (!keys.has(rawKey as ConfigKey)) throw new Error("Config key must be base-url, model, api-key, or max-steps");
  const key = rawKey as ConfigKey;

  if (action === "unset") {
    const property = ({ "base-url": "baseURL", model: "model", "api-key": "apiKey", "max-steps": "maxSteps" } as const)[key];
    delete stored[property];
    await saveStoredConfig(stored, path);
    console.log(`Unset ${key}.`);
    return;
  }

  if (!process.stdin.isTTY) throw new Error("Interactive configuration requires a terminal");
  if (key === "api-key" && inlineValue) throw new Error("For safety, config set api-key does not accept a command-line value");
  let value: string;
  if (key === "api-key") {
    value = await promptSecret("API key");
  } else {
    const initialValue = key === "base-url" ? stored.baseURL : key === "model" ? stored.model : stored.maxSteps?.toString();
    const message = key === "base-url" ? "OpenAI-compatible base URL" : key === "model" ? "Model" : "Maximum agent steps";
    value = inlineValue || await promptText(message, initialValue);
  }
  if (!value) throw new Error("Value is required");
  if (key === "base-url" && !/^https?:$/.test(new URL(value).protocol)) throw new Error("Base URL must use http or https");
  if (key === "max-steps" && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 50)) throw new Error("Maximum steps must be an integer from 1 to 50");

  const next: StoredConfig = { ...stored };
  if (key === "base-url") next.baseURL = new URL(value).href.replace(/\/$/, "");
  else if (key === "model") next.model = value.trim();
  else if (key === "api-key") next.apiKey = value;
  else next.maxSteps = Number(value);
  await saveStoredConfig(next, path);
  console.log(`Saved ${key} to ${path}.`);
}
