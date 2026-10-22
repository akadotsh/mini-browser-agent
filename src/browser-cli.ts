import { createInterface } from "node:readline/promises";
import { BrowserSession } from "./browser-session";
import { parseInstruction, splitFirst } from "./commands";

export const browserHelp = `Commands:
  open <url>                 Load an HTTP(S) page
  snapshot                  Show compact text and interactive element refs
  click <ref|css:selector>  Click an element
  type <ref> <text>         Focus an element ref and type
  press <key>               Press Enter, Tab, Escape, arrows, etc.
  scroll <pixels>           Scroll vertically (negative goes up)
  text [css:selector]       Read page or element text
  links                     List visible links
  screenshot [path]         Save PNG, JPEG, or WebP under ~/Mini Browser Agent/Screenshots
  back | forward | reload | url | help | quit`;

export async function runBrowserRepl() {
  const browser = new BrowserSession();
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  console.log(`Mini Browser Agent\n${browserHelp}`);

  async function execute(line: string): Promise<void> {
    const { action, value } = parseInstruction(line);
    let result: unknown;
    switch (action) {
      case "open": if (!value) throw new Error("Usage: open <url>"); result = await browser.navigate(value); break;
      case "snapshot": result = await browser.snapshot(); break;
      case "click": if (!value) throw new Error("Usage: click <ref|css:selector>"); result = await browser.click(value); break;
      case "type": { const [ref, text] = splitFirst(value); if (!ref || !text) throw new Error("Usage: type <ref> <text>"); result = await browser.type(ref, text); break; }
      case "press": if (!value) throw new Error("Usage: press <key>"); result = await browser.press(value); break;
      case "scroll": result = await browser.scroll(Number(value)); break;
      case "text": result = await browser.extractText(value || undefined); break;
      case "links": result = await browser.extractLinks(); break;
      case "screenshot": result = await browser.screenshot(value); break;
      case "back": result = await browser.back(); break;
      case "forward": result = await browser.forward(); break;
      case "reload": result = await browser.reload(); break;
      case "url": result = browser.status(); break;
      case "help": console.log(browserHelp); return;
      case "": return;
      default: throw new Error(`Unknown command: ${action}. Type "help".`);
    }
    if (typeof result === "string") console.log(result);
    else console.dir(result, { depth: null, colors: process.stdout.isTTY });
  }

  try {
    while (true) {
      let line: string;
      try { line = await terminal.question(process.stdin.isTTY ? "> " : ""); } catch { break; }
      if (line.trim().toLowerCase() === "quit") break;
      try { await execute(line); } catch (error) { console.error(`Error: ${error instanceof Error ? error.message : error}`); }
    }
  } finally {
    terminal.close();
    browser.close();
  }
}
