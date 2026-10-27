#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { createCompatibleModel, readAgentConfig, runAgent } from "./agent";
import { runBrowserRepl } from "./browser-cli";
import { BrowserSession } from "./browser-session";
import { createChromeBrowserSession } from "./chrome-session";
import { runConfigCommand } from "./config-cli";
import { loadStoredConfig } from "./config";

const help = `Mini Browser Agent

Usage:
  mini-browser-agent run [--headed] "<task>"  Run a natural-language browser task
  mini-browser-agent browser [--headed]       Open the deterministic browser REPL
  mini-browser-agent config [show|set|unset]
                                  Manage AI configuration
  mini-browser-agent help          Show this help`;

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "browser") return await runBrowserRepl(args.includes("--headed"));
  if (command === "config") return await runConfigCommand(args);
  if (command === "help" || command === "--help" || command === "-h") return console.log(help);
  if (command !== "run") throw new Error(`Unknown command: ${command}\n\n${help}`);

  const headed = args.includes("--headed");
  const prompt = args.filter(arg => arg !== "--headed").join(" ").trim();
  if (!prompt) throw new Error('Usage: mini-browser-agent run "<task>"');
  const config = readAgentConfig(process.env, await loadStoredConfig());
  if (headed && !process.stdin.isTTY) throw new Error("Headed mode needs an interactive terminal for its one-time browser-control approval.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const ask = async (message: string) => {
    if (!process.stdin.isTTY) return false;
    while (true) {
      const answer = (await terminal.question(`${message} [y/N] `)).trim().toLowerCase();
      if (answer === "y" || answer === "yes") return true;
      if (!answer || answer === "n" || answer === "no") return false;
      console.error("Invalid response. Enter y or n, then try again.");
    }
  };
  let session;
  try {
    while (true) {
      try {
        session = headed ? await createChromeBrowserSession() : { browser: new BrowserSession(), close: () => {} };
        break;
      } catch (error) {
        if (!headed || !(error instanceof Error) || !error.message.startsWith("No Chrome extension connected") || !process.stdin.isTTY) throw error;
        console.error(error.message);
        while (true) {
          const retry = (await terminal.question("Load or reload this repo's chrome-extension folder in chrome://extensions, then press Enter to retry (type n to cancel): ")).trim().toLowerCase();
          if (!retry) break;
          if (retry === "n" || retry === "no") throw error;
          console.error("Invalid response. Press Enter to retry, or type n to cancel.");
        }
      }
    }
    const { browser } = session;
    if (headed && !(await ask("Allow Mini Browser Agent to control Chrome for this run?"))) {
      console.log("Browser control was not approved; exiting.");
      return;
    }
    const confirm = headed ? async () => true : ask;

    console.log(`Model: ${config.model}\nEndpoint: ${config.baseURL}`);
    const result = await runAgent({ prompt, model: createCompatibleModel(config), browser, confirm, maxSteps: config.maxSteps });
    console.log(`\n${result.text || "Task ended without a summary."}\n\nSteps: ${result.steps}`);
  } finally {
    terminal.close();
    if (session) {
      if (headed) await session.close();
      else session.browser.close();
    }
  }
}

main().catch(error => {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
