#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { createCompatibleModel, readAgentConfig, runAgent } from "./agent";
import { runBrowserRepl } from "./browser-cli";
import { BrowserSession } from "./browser-session";
import { runConfigCommand } from "./config-cli";
import { loadStoredConfig } from "./config";

const help = `Mini Browser Agent

Usage:
  mini-browser-agent run "<task>"  Run a natural-language browser task
  mini-browser-agent browser       Open the deterministic browser REPL
  mini-browser-agent config [show|set|unset]
                                  Manage AI configuration
  mini-browser-agent help          Show this help`;

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "browser") return await runBrowserRepl();
  if (command === "config") return await runConfigCommand(args);
  if (command === "help" || command === "--help" || command === "-h") return console.log(help);
  if (command !== "run") throw new Error(`Unknown command: ${command}\n\n${help}`);

  const prompt = args.join(" ").trim();
  if (!prompt) throw new Error('Usage: mini-browser-agent run "<task>"');
  const config = readAgentConfig(process.env, await loadStoredConfig());
  const browser = new BrowserSession();
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const confirm = async (message: string) => {
    if (!process.stdin.isTTY) return false;
    const answer = await terminal.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  };

  console.log(`Model: ${config.model}\nEndpoint: ${config.baseURL}`);
  try {
    const result = await runAgent({ prompt, model: createCompatibleModel(config), browser, confirm, maxSteps: config.maxSteps });
    console.log(`\n${result.text || "Task ended without a summary."}\n\nSteps: ${result.steps}`);
  } finally {
    terminal.close();
    browser.close();
  }
}

main().catch(error => {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
