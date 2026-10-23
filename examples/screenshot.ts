import { createCompatibleModel, readAgentConfig, runAgent } from "../src/agent";
import { BrowserSession } from "../src/browser-session";
import { loadStoredConfig } from "../src/config";

const config = readAgentConfig(process.env, await loadStoredConfig());
const browser = new BrowserSession();

try {
  const result = await runAgent({
    prompt: "Open https://example.com, verify its page title, and save a JPEG screenshot named example-home.jpg.",
    model: createCompatibleModel(config),
    browser,
    maxSteps: config.maxSteps,
    log: message => console.log(`[browser] ${message}`),
    confirm: async message => {
      console.log(`[denied] Unexpected interactive action: ${message}`);
      return false;
    },
  });

  console.log("\nScreenshot result:\n");
  console.log(result.text);
  console.log(`\nCompleted in ${result.steps} agent step(s).`);
} finally {
  browser.close();
}
