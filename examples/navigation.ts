import { createInterface } from "node:readline/promises";
import { createCompatibleModel, readAgentConfig, runAgent } from "../src/agent";
import { BrowserSession } from "../src/browser-session";
import { loadStoredConfig } from "../src/config";

const config = readAgentConfig(process.env, await loadStoredConfig());
const browser = new BrowserSession();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

try {
  const result = await runAgent({
    prompt: "Open https://news.ycombinator.com, follow the first story, and return its title, destination URL, and a short summary.",
    model: createCompatibleModel(config),
    browser,
    maxSteps: config.maxSteps,
    log: message => console.log(`[browser] ${message}`),
    confirm: async message => {
      const answer = await terminal.question(`${message} [y/N] `);
      return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
    },
  });

  console.log("\nNavigation result:\n");
  console.log(result.text);
  console.log(`\nCompleted in ${result.steps} agent step(s).`);
} finally {
  terminal.close();
  browser.close();
}
